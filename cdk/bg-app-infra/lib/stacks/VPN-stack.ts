import * as path from "path";
import * as cdk from "aws-cdk-lib/core";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as cr from "aws-cdk-lib/custom-resources";
import { Construct } from "constructs";
import { EnvConfig } from "../config";

interface VpnStackProps extends cdk.StackProps {
  cfg: EnvConfig;
  vpc: ec2.Vpc;
  users?: string[];
}

export class VpnStack extends cdk.Stack {
  public readonly vpnClientCidr = "172.16.0.0/22";

  constructor(scope: Construct, id: string, props: VpnStackProps) {
    super(scope, id, props);

    const { cfg, vpc, users = ["user1"] } = props;

    // S3 bucket — stores per-user .ovpn files and intermediate PKI material
    const vpnBucket = new s3.Bucket(this, "VpnConfigBucket", {
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    });

    // Single Lambda handles both CertGen and OvpnGen resource types
    const certGenFn = new lambda.Function(this, "VpnCertGenFn", {
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: "index.on_event",
      code: lambda.Code.fromAsset(
        path.join(__dirname, "../lambda/cert-gen"),
      ),
      timeout: cdk.Duration.minutes(10),
      memorySize: 256,
      environment: { BUCKET_NAME: vpnBucket.bucketName },
    });

    vpnBucket.grantReadWrite(certGenFn);
    certGenFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "acm:ImportCertificate",
          "acm:AddTagsToCertificate",
          "acm:DeleteCertificate",
        ],
        resources: ["*"],
      }),
    );
    certGenFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["ec2:DescribeClientVpnEndpoints"],
        resources: ["*"],
      }),
    );

    const vpnCrProvider = new cr.Provider(this, "VpnCrProvider", {
      onEventHandler: certGenFn,
    });

    // Step 1 — generate CA, server cert, and per-user client certs
    const certGenResource = new cdk.CustomResource(
      this,
      "VpnCertGenResource",
      {
        serviceToken: vpnCrProvider.serviceToken,
        properties: {
          ResourceType: "CertGen",
          VpnDomain: `vpn.${cfg.envName}`,
          Users: JSON.stringify(users),
        },
      },
    );

    // Step 2 — Client VPN endpoint (depends on server cert via token reference)
    const vpnEndpoint = new ec2.ClientVpnEndpoint(
      this,
      "ClientVpnEndpoint",
      {
        vpc,
        cidr: this.vpnClientCidr,
        serverCertificateArn: certGenResource.getAttString("ServerCertArn"),
        clientCertificateArn: certGenResource.getAttString("ClientCACertArn"),
        splitTunnel: true,
        logging: false,
        selfServicePortal: false,
        vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
        authorizeAllUsersToVpcCidr: true,
      },
    );

    // Route the entire VPC CIDR through the isolated subnet
    vpnEndpoint.addRoute("RouteToVpc", {
      cidr: cfg.vpcCidr,
      target: ec2.ClientVpnRouteTarget.subnet(
        vpc.isolatedSubnets[0] as ec2.Subnet,
      ),
    });

    // Step 3 — assemble .ovpn files once the endpoint DNS is resolvable
    new cdk.CustomResource(this, "VpnOvpnGenResource", {
      serviceToken: vpnCrProvider.serviceToken,
      properties: {
        ResourceType: "OvpnGen",
        EndpointId: vpnEndpoint.endpointId,
        BucketName: vpnBucket.bucketName,
        Users: JSON.stringify(users),
      },
    });

    new cdk.CfnOutput(this, "VpnConfigBucket", {
      value: vpnBucket.bucketName,
      description:
        "Download: aws s3 cp s3://<bucket>/clients/user1/user1.ovpn .",
    });
  }
}
