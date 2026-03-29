import * as cdk from "aws-cdk-lib/core";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as ram from "aws-cdk-lib/aws-ram";
import { Construct } from "constructs";
import { EnvConfig } from "../config";

interface NetworkStackProps extends cdk.StackProps {
  cfg: EnvConfig;
}
export class NetworkStack extends cdk.Stack {
  public readonly vpc: ec2.Vpc;

  constructor(scope: Construct, id: string, props: NetworkStackProps) {
    super(scope, id, props);

    const { cfg } = props;

    this.vpc = new ec2.Vpc(this, `${cfg.envName}Vpc`, {
      vpcName: `${cfg.envName}-vpc`,
      ipAddresses: ec2.IpAddresses.cidr(cfg.vpcCidr),
      maxAzs: 1,
      natGateways: 0,
      subnetConfiguration: [
        {
          name: "PrivateData",
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
          cidrMask: 24,
        },
      ],
    });

    const vpc = this.vpc;

    // ── SSM Interface Endpoints (no NAT/IGW required) ─────────────────────────
    const endpointSg = new ec2.SecurityGroup(this, "EndpointSg", {
      vpc,
      description: "Allow HTTPS from Shared VPC for SSM endpoints",
      allowAllOutbound: true,
    });
    endpointSg.addIngressRule(
      ec2.Peer.ipv4(cfg.vpcCidr),
      ec2.Port.tcp(443),
      "HTTPS from Shared VPC",
    );
    vpc.addInterfaceEndpoint("SsmEndpoint", {
      service: ec2.InterfaceVpcEndpointAwsService.SSM,
      securityGroups: [endpointSg],
    });
    vpc.addInterfaceEndpoint("SsmMessagesEndpoint", {
      service: ec2.InterfaceVpcEndpointAwsService.SSM_MESSAGES,
      securityGroups: [endpointSg],
    });
    vpc.addInterfaceEndpoint("Ec2MessagesEndpoint", {
      service: ec2.InterfaceVpcEndpointAwsService.EC2_MESSAGES,
      securityGroups: [endpointSg],
    });

    // ── EC2 (SSM test client) ─────────────────────────────────────────────────
    const ec2Role = new iam.Role(this, "Ec2Role", {
      assumedBy: new iam.ServicePrincipal("ec2.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "AmazonSSMManagedInstanceCore",
        ),
      ],
    });
    const sg = new ec2.SecurityGroup(this, "Ec2Sg", {
      vpc,
      allowAllOutbound: true,
    });
    const instance = new ec2.Instance(this, "Ec2Instance", {
      vpc,
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T3,
        ec2.InstanceSize.NANO,
      ),
      machineImage: ec2.MachineImage.latestAmazonLinux2023(),
      securityGroup: sg,
      role: ec2Role,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
    });
    instance.addUserData("#!/bin/bash", "yum install -y nc");

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
  }
}
