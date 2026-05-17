import * as cdk from "aws-cdk-lib/core";
import * as ec2 from "aws-cdk-lib/aws-ec2";

const vpcCidrConfig = {
  shared: "10.0.0.0/16",
  dev: "10.1.0.0/16",
  prod: "10.2.0.0/16",
};

export type AppEnv = "shared" | "dev" | "prod";

export interface RdsConfig {
  instanceClass: ec2.InstanceClass;
  instanceSize: ec2.InstanceSize;
  allocatedStorage: number; // GB
  multiAz: boolean;
  backupRetentionDays: number;
  deletionProtection: boolean;
  removalPolicy: cdk.RemovalPolicy;
}

export interface EnvConfig {
  envName: AppEnv;
  orgId: string;
  orgAccountId: string;
  account: string; // AWS account ID for this environment
  region: string;
  profile: string; // SSO profile name
  rootAccountId?: string; // only needed for non-organization root accounts, used for cross-account deployments

  // ECS
  ecsAppPort: number;
  ecsCpu: number;
  ecsMemory: number;
  ecsMinTasks: number;
  ecsMaxTasks: number;

  vpcCidr: string;
  tgwConfig?: {
    destinationVPCidr: string;
    targetVPCcidr: string;
    transitGatewayId?: string;
  };

  rdsConfig?: RdsConfig; // undefined on environments that don't run RDS
}

export const ENV_CONFIG: Record<AppEnv, EnvConfig> = {
  shared: {
    envName: "shared",
    orgId: "o-yr7s22wlau",
    orgAccountId: "448658736684",
    account: "084847996201",
    region: "ap-southeast-2",
    profile: "bg-shared",
    ecsAppPort: 0,
    ecsCpu: 256,
    ecsMemory: 512,
    ecsMinTasks: 1,
    ecsMaxTasks: 1,

    vpcCidr: vpcCidrConfig.shared,
    tgwConfig: {
      destinationVPCidr: vpcCidrConfig.dev,
      targetVPCcidr: vpcCidrConfig.shared,
    },
    // No RDS in the shared account
  },

  dev: {
    envName: "dev",
    orgId: "",
    orgAccountId: "",
    account: "611411463255",
    region: "ap-southeast-2",
    profile: "bg-dev",
    ecsAppPort: 8080,
    ecsCpu: 256,
    ecsMemory: 512,
    ecsMinTasks: 1,
    ecsMaxTasks: 2,
    rootAccountId: "448658736684", // needed for cross-account deployments from dev to shared

    vpcCidr: vpcCidrConfig.dev,
    tgwConfig: {
      destinationVPCidr: vpcCidrConfig.shared,
      targetVPCcidr: vpcCidrConfig.dev,
      transitGatewayId: "tgw-03bed3d5a309c899f",
    },

    rdsConfig: {
      instanceClass: ec2.InstanceClass.T4G,
      instanceSize: ec2.InstanceSize.MICRO,
      allocatedStorage: 100,
      multiAz: false,
      backupRetentionDays: 1,
      deletionProtection: false,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    },
  },

  prod: {
    envName: "prod",
    orgId: "",
    orgAccountId: "",
    account: "",
    region: "",
    profile: "",

    ecsAppPort: 8080,
    ecsCpu: 512,
    ecsMemory: 1024,
    ecsMinTasks: 2,
    ecsMaxTasks: 10,

    vpcCidr: vpcCidrConfig.prod,
    // rdsConfig added here when prod RDS is ready to provision
  },
};
