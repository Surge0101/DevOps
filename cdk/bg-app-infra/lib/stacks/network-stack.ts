import * as cdk from "aws-cdk-lib/core";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as ram from "aws-cdk-lib/aws-ram";
import { Construct } from "constructs";
import { EnvConfig } from "../config";

interface NetworkStackProps extends cdk.StackProps {
  cfg: EnvConfig;
}

function createTestInstance(
  scope: cdk.Stack,
  vpc: ec2.Vpc,
  idPrefix: string,
  ingressPeer?: ec2.IPeer,
  listenerPort?: number,
): ec2.Instance {
  const ec2Role = new iam.Role(scope, `${idPrefix}Ec2Role`, {
    assumedBy: new iam.ServicePrincipal("ec2.amazonaws.com"),
    managedPolicies: [
      iam.ManagedPolicy.fromAwsManagedPolicyName(
        "AmazonSSMManagedInstanceCore",
      ),
    ],
  });

  const sg = new ec2.SecurityGroup(scope, `${idPrefix}Ec2Sg`, {
    vpc,
    allowAllOutbound: true,
  });

  if (ingressPeer && listenerPort) {
    sg.addIngressRule(
      ingressPeer,
      ec2.Port.tcp(listenerPort),
      `Allow TGW connectivity tests on port ${listenerPort}`,
    );
  }

  const instance = new ec2.Instance(scope, `${idPrefix}Ec2Instance`, {
    vpc,
    instanceType: ec2.InstanceType.of(
      ec2.InstanceClass.T4G,
      ec2.InstanceSize.NANO,
    ),
    machineImage: ec2.MachineImage.latestAmazonLinux2023({
      cpuType: ec2.AmazonLinuxCpuType.ARM_64,
    }),
    securityGroup: sg,
    role: ec2Role,
    vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
  });

  instance.addUserData("#!/bin/bash", "dnf install -y nmap-ncat");

  if (listenerPort) {
    instance.addUserData(
      "cat >/etc/systemd/system/tgw-test-listener.service <<'EOF'",
      "[Unit]",
      "Description=TGW connectivity test listener",
      "After=network-online.target",
      "",
      "[Service]",
      "Type=simple",
      `ExecStart=/usr/bin/ncat -lk -p ${listenerPort} --keep-open --exec '/usr/bin/printf "tgw-ok\\n"'`,
      "Restart=always",
      "",
      "[Install]",
      "WantedBy=multi-user.target",
      "EOF",
      "systemctl daemon-reload",
      "systemctl enable --now tgw-test-listener.service",
    );
  }

  new cdk.CfnOutput(scope, `${idPrefix}InstanceId`, {
    value: instance.instanceId,
  });
  new cdk.CfnOutput(scope, `${idPrefix}PrivateIp`, {
    value: instance.instancePrivateIp,
  });

  return instance;
}

export class NetworkStack extends cdk.Stack {
  public readonly vpc: ec2.Vpc;
  public readonly albSg: ec2.SecurityGroup;
  public readonly ecsSg: ec2.SecurityGroup;
  public readonly rdsSg: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props: NetworkStackProps) {
    super(scope, id, props);

    const { cfg } = props;

    this.vpc = new ec2.Vpc(this, `${cfg.envName}Vpc`, {
      vpcName: `${cfg.envName}-vpc`,
      ipAddresses: ec2.IpAddresses.cidr(cfg.vpcCidr),
      //move into config for reuseablity
      maxAzs: 2, // Required for RDS subnet group redundancy
      natGateways: 0,
      subnetConfiguration: [
        { subnetType: ec2.SubnetType.PUBLIC, name: "Public", cidrMask: 24 },
        {
          name: "PrivateApp",
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
          cidrMask: 24,
        },
        {
          name: "PrivateData",
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
          cidrMask: 24,
        },
      ],
    });

    const vpc = this.vpc;
    const sharedVpcCidr = props.cfg.tgwConfig?.destinationVPCidr ?? "";
    const sharedTgwId =
      (this.node.tryGetContext("sharedTgwId") as string | undefined) ??
      cfg.tgwConfig?.transitGatewayId;

    if (cfg.envName === "dev" && !sharedTgwId) {
      throw new Error(
        'The dev environment requires a shared TGW ID. Pass it with "-c sharedTgwId=<tgw-id>" or set cfg.tgwConfig.transitGatewayId.',
      );
    }

    // // ── SSM Interface Endpoints (no NAT/IGW required) ─────────────────────────
    // const endpointSg = new ec2.SecurityGroup(this, "EndpointSg", {
    //   vpc,
    //   description: "Allow HTTPS from Shared VPC for SSM endpoints",
    //   allowAllOutbound: true,
    // });
    // endpointSg.addIngressRule(
    //   ec2.Peer.ipv4(cfg.vpcCidr),
    //   ec2.Port.tcp(443),
    //   "HTTPS from Shared VPC",
    // );
    // // Private AWS service access for workloads in isolated subnets.
    // [
    //   {
    //     id: "SsmEndpoint",
    //     service: ec2.InterfaceVpcEndpointAwsService.SSM,
    //   },
    //   {
    //     id: "SsmMessagesEndpoint",
    //     service: ec2.InterfaceVpcEndpointAwsService.SSM_MESSAGES,
    //   },
    //   {
    //     id: "Ec2MessagesEndpoint",
    //     service: ec2.InterfaceVpcEndpointAwsService.EC2_MESSAGES,
    //   },
    //   {
    //     id: "CloudWatchLogsEndpoint",
    //     service: ec2.InterfaceVpcEndpointAwsService.CLOUDWATCH_LOGS,
    //   },
    //   {
    //     id: "KmsEndpoint",
    //     service: ec2.InterfaceVpcEndpointAwsService.KMS,
    //   },
    //   {
    //     id: "SecretsManagerEndpoint",
    //     service: ec2.InterfaceVpcEndpointAwsService.SECRETS_MANAGER,
    //   },
    // ].forEach(({ id, service }) => {
    //   vpc.addInterfaceEndpoint(id, {
    //     service,
    //     securityGroups: [endpointSg],
    //   });
    // });

    if (cfg.envName === "shared") {
      createTestInstance(this, vpc, "Shared");
    } else {
      // S3 VPC Gateway Endpoint - ECR uses S3 for image layers (free)
      vpc.addGatewayEndpoint("S3Endpoint", {
        service: ec2.GatewayVpcEndpointAwsService.S3,
        subnets: [{ subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS }],
      });

      // Interface endpoints — required for Fargate with no NAT gateway
      const endpointSg = new ec2.SecurityGroup(this, "EndpointSg", {
        vpc,
        description: "Allow HTTPS from VPC for interface endpoints",
        allowAllOutbound: false,
      });
      endpointSg.addIngressRule(
        ec2.Peer.ipv4(cfg.vpcCidr),
        ec2.Port.tcp(443),
        "HTTPS from VPC",
      );

      [
        { id: "EcrApiEndpoint",         service: ec2.InterfaceVpcEndpointAwsService.ECR },
        { id: "EcrDkrEndpoint",         service: ec2.InterfaceVpcEndpointAwsService.ECR_DOCKER },
        { id: "SecretsManagerEndpoint", service: ec2.InterfaceVpcEndpointAwsService.SECRETS_MANAGER },
        { id: "CloudWatchLogsEndpoint", service: ec2.InterfaceVpcEndpointAwsService.CLOUDWATCH_LOGS },
        { id: "KmsEndpoint",            service: ec2.InterfaceVpcEndpointAwsService.KMS },
        { id: "SsmMessagesEndpoint",    service: ec2.InterfaceVpcEndpointAwsService.SSM_MESSAGES },
      ].forEach(({ id, service }) => {
        vpc.addInterfaceEndpoint(id, {
          service,
          securityGroups: [endpointSg],
          subnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        });
      });

      // Security groups: ALB, ECS, RDS
      this.albSg = new ec2.SecurityGroup(this, "AlbSg", {
        vpc: this.vpc,
        securityGroupName: `${cfg.envName}-alb-sg`,
        description: "ALB - public HTTPS and HTTP redirect",
        allowAllOutbound: true,
      });

      this.albSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), "HTTPS");
      this.albSg.addIngressRule(
        ec2.Peer.anyIpv4(),
        ec2.Port.tcp(80),
        "HTTP redirect",
      );

      this.ecsSg = new ec2.SecurityGroup(this, "EcsSg", {
        vpc: this.vpc,
        securityGroupName: `${cfg.envName}-ecs-sg`,
        description: "ECS tasks - inbound from ALB only",
        allowAllOutbound: true,
      });

      this.ecsSg.addIngressRule(
        ec2.Peer.securityGroupId(this.albSg.securityGroupId),
        ec2.Port.tcp(cfg.ecsAppPort),
        "From ALB",
      );

      this.rdsSg = new ec2.SecurityGroup(this, "RdsSg", {
        vpc: this.vpc,
        securityGroupName: `${cfg.envName}-rds-sg`,
        description: "RDS PostgreSQL - inbound 5432 from ECS only",
        allowAllOutbound: false,
      });

      this.rdsSg.addIngressRule(
        ec2.Peer.securityGroupId(this.ecsSg.securityGroupId),
        ec2.Port.tcp(5432),
        "PostgreSQL from ECS",
      );

      //createTestInstance(this, vpc, "Dev", ec2.Peer.ipv4(sharedVpcCidr), 8080);
    }

    if (cfg.envName === "shared") {
      const tgw = new ec2.CfnTransitGateway(this, "TGW", {
        description: "Central Transit Gateway for Shared/Dev hub",
        autoAcceptSharedAttachments: "enable",
        defaultRouteTableAssociation: "enable",
        defaultRouteTablePropagation: "enable",
        tags: [{ key: "Name", value: "Central-TGW" }],
      });

      // Attach Shared VPC to TGW
      const sharedAttachment = new ec2.CfnTransitGatewayAttachment(
        this,
        "SharedVpcAttachment",
        {
          transitGatewayId: tgw.ref, // References the TGW created above
          vpcId: this.vpc.vpcId,
          subnetIds: vpc.isolatedSubnets.map((s) => s.subnetId),
          tags: [{ key: "Name", value: "shared-VPC-Attachment" }],
        },
      );

      // Routes: Shared subnet -> Dev via TGW
      const routeTable = vpc.isolatedSubnets[0].routeTable.routeTableId;

      new ec2.CfnRoute(this, `SharedToDevRoute`, {
        routeTableId: routeTable,
        destinationCidrBlock: cfg.tgwConfig?.destinationVPCidr ?? "",
        transitGatewayId: tgw.ref,
      }).addDependency(sharedAttachment);

      // RAM Configuration
      new ram.CfnResourceShare(this, "TGWRamShare", {
        name: "Central-TGW-Share",
        resourceArns: [
          `arn:aws:ec2:${this.region}:${this.account}:transit-gateway/${tgw.ref}`,
        ],
        principals: [
          `arn:aws:organizations::${cfg.orgAccountId}:organization/${cfg.orgId}`,
        ],
        allowExternalPrincipals: false,
      });

      new cdk.CfnOutput(this, "TGWId", {
        value: tgw.ref,
      });
    }

    // if (cfg.envName === "dev" && sharedTgwId && cfg.tgwConfig) {
    //   const devAttachment = new ec2.CfnTransitGatewayAttachment(
    //     this,
    //     "DevVpcAttachment",
    //     {
    //       transitGatewayId: sharedTgwId,
    //       vpcId: this.vpc.vpcId,
    //       subnetIds: vpc.isolatedSubnets.map((s) => s.subnetId),
    //       tags: [{ key: "Name", value: "dev-VPC-Attachment" }],
    //     },
    //   );

    //   const routeTable = vpc.isolatedSubnets[0].routeTable.routeTableId;

    //   new ec2.CfnRoute(this, "DevToSharedRoute", {
    //     routeTableId: routeTable,
    //     destinationCidrBlock: cfg.tgwConfig.destinationVPCidr,
    //     transitGatewayId: sharedTgwId,
    //   }).addDependency(devAttachment);

    //   new cdk.CfnOutput(this, "AttachedSharedTgwId", {
    //     value: sharedTgwId,
    //   });
    // }
  }
}
