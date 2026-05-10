import json
import os
import subprocess
import tempfile

import boto3


def on_event(event, context):
    resource_type = event["ResourceProperties"]["ResourceType"]
    request_type = event["RequestType"]
    phys_id = event.get(
        "PhysicalResourceId",
        f"vpn-{resource_type.lower()}-{context.aws_request_id[:8]}",
    )

    if resource_type == "CertGen":
        if request_type == "Delete":
            _delete_acm_certs()
            return {"PhysicalResourceId": phys_id}
        data = _cert_gen(event)
        return {"PhysicalResourceId": phys_id, "Data": data}

    if resource_type == "OvpnGen":
        if request_type != "Delete":
            _ovpn_gen(event)
        return {"PhysicalResourceId": phys_id}

    raise ValueError(f"Unknown ResourceType: {resource_type}")


# ── Cert generation ────────────────────────────────────────────────────────────

def _cert_gen(event):
    props = event["ResourceProperties"]
    domain = props["VpnDomain"]
    users = json.loads(props["Users"])
    bucket = os.environ["BUCKET_NAME"]

    acm = boto3.client("acm")
    s3 = boto3.client("s3")

    with tempfile.TemporaryDirectory() as d:
        # Root CA
        _run(["openssl", "genrsa", "-out", f"{d}/ca.key", "4096"])
        _run([
            "openssl", "req", "-new", "-x509", "-days", "3650",
            "-key", f"{d}/ca.key", "-out", f"{d}/ca.crt",
            "-subj", f"/CN={domain}-ca",
        ])

        # Server cert
        _run(["openssl", "genrsa", "-out", f"{d}/server.key", "4096"])
        _run([
            "openssl", "req", "-new",
            "-key", f"{d}/server.key", "-out", f"{d}/server.csr",
            "-subj", f"/CN=server.{domain}",
        ])
        _run([
            "openssl", "x509", "-req", "-days", "3650",
            "-in", f"{d}/server.csr",
            "-CA", f"{d}/ca.crt", "-CAkey", f"{d}/ca.key", "-CAcreateserial",
            "-out", f"{d}/server.crt",
        ])

        ca_pem = open(f"{d}/ca.crt").read()
        server_pem = open(f"{d}/server.crt").read()
        server_key = open(f"{d}/server.key").read()

        server_arn = acm.import_certificate(
            Certificate=server_pem.encode(),
            PrivateKey=server_key.encode(),
            CertificateChain=ca_pem.encode(),
        )["CertificateArn"]

        ca_arn = acm.import_certificate(
            Certificate=ca_pem.encode(),
        )["CertificateArn"]

        # Store CA and ARN map in S3 for .ovpn generation and cleanup
        s3.put_object(Bucket=bucket, Key="pki/ca.crt", Body=ca_pem, ContentType="text/plain")
        s3.put_object(
            Bucket=bucket,
            Key="pki/arns.json",
            Body=json.dumps({"ServerCertArn": server_arn, "ClientCACertArn": ca_arn}),
            ContentType="application/json",
        )

        # Per-user client certs
        for user in users:
            _run(["openssl", "genrsa", "-out", f"{d}/{user}.key", "4096"])
            _run([
                "openssl", "req", "-new",
                "-key", f"{d}/{user}.key", "-out", f"{d}/{user}.csr",
                "-subj", f"/CN={user}.{domain}",
            ])
            _run([
                "openssl", "x509", "-req", "-days", "3650",
                "-in", f"{d}/{user}.csr",
                "-CA", f"{d}/ca.crt", "-CAkey", f"{d}/ca.key", "-CAcreateserial",
                "-out", f"{d}/{user}.crt",
            ])
            s3.put_object(Bucket=bucket, Key=f"clients/{user}/client.crt",
                          Body=open(f"{d}/{user}.crt").read(), ContentType="text/plain")
            s3.put_object(Bucket=bucket, Key=f"clients/{user}/client.key",
                          Body=open(f"{d}/{user}.key").read(), ContentType="text/plain")

        return {"ServerCertArn": server_arn, "ClientCACertArn": ca_arn}


def _delete_acm_certs():
    bucket = os.environ["BUCKET_NAME"]
    try:
        s3 = boto3.client("s3")
        arns = json.loads(s3.get_object(Bucket=bucket, Key="pki/arns.json")["Body"].read())
        acm = boto3.client("acm")
        for arn in arns.values():
            try:
                acm.delete_certificate(CertificateArn=arn)
            except Exception:
                pass
    except Exception:
        pass


# ── .ovpn generation ───────────────────────────────────────────────────────────

def _ovpn_gen(event):
    props = event["ResourceProperties"]
    endpoint_id = props["EndpointId"]
    bucket = props["BucketName"]
    users = json.loads(props["Users"])

    ec2_client = boto3.client("ec2")
    endpoints = ec2_client.describe_client_vpn_endpoints(
        ClientVpnEndpointIds=[endpoint_id]
    )["ClientVpnEndpoints"]

    if not endpoints:
        raise RuntimeError(f"Client VPN endpoint {endpoint_id} not found")

    endpoint_dns = endpoints[0]["DnsName"]

    s3 = boto3.client("s3")
    ca_pem = s3.get_object(Bucket=bucket, Key="pki/ca.crt")["Body"].read().decode()

    for user in users:
        client_cert = s3.get_object(Bucket=bucket, Key=f"clients/{user}/client.crt")["Body"].read().decode()
        client_key = s3.get_object(Bucket=bucket, Key=f"clients/{user}/client.key")["Body"].read().decode()

        ovpn = "\n".join([
            "client",
            "dev tun",
            "proto udp",
            f"remote {endpoint_dns} 443",
            "resolv-retry infinite",
            "nobind",
            "persist-key",
            "persist-tun",
            "remote-cert-tls server",
            "cipher AES-256-GCM",
            "verb 3",
            "",
            "<ca>",
            ca_pem.strip(),
            "</ca>",
            "<cert>",
            client_cert.strip(),
            "</cert>",
            "<key>",
            client_key.strip(),
            "</key>",
        ])

        s3.put_object(
            Bucket=bucket,
            Key=f"clients/{user}/{user}.ovpn",
            Body=ovpn,
            ContentType="application/x-openvpn-profile",
        )


# ── helpers ────────────────────────────────────────────────────────────────────

def _run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"{cmd[0]} failed:\n{r.stderr}")
