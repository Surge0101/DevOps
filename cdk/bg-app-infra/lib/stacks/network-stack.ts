import * as cdk from "aws-cdk-lib/core";
import * as ec2 from "aws-cdk-lib/aws-ec2";
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
  }
}
