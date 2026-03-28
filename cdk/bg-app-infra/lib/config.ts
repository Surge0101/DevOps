const vpcCidrConfig = {
  shared: "10.0.0.0/16",
  dev: "10.1.0.0/16",
  prod: "10.2.0.0/16",
};

export type AppEnv = "shared" | "dev" | "prod";

export interface EnvConfig {
  envName: AppEnv;
  orgId: string;
  orgAccountId: string;
  account: string; // AWS account ID for this environment
  region: string;
  profile: string; // SSO profile name

  rdsStorageSize: number;
  vpcCidr: string;
}
export const ENV_CONFIG: Record<AppEnv, EnvConfig> = {
  shared: {
    envName: "shared",
    orgId: "",
    orgAccountId: "",
    account: "084847996201",
    region: "ap-southeast-2",
    profile: "bg-shared",
    rdsStorageSize: 0,

    vpcCidr: vpcCidrConfig.shared,
  },
  dev: {
    envName: "dev",
    orgId: "",
    orgAccountId: "",
    account: "611411463255",
    region: "ap-southeast-2",
    profile: "bg-dev",
    rdsStorageSize: 100,

    vpcCidr: vpcCidrConfig.dev,
  },
  prod: {
    envName: "prod",
    orgId: "",
    orgAccountId: "",
    account: "",
    region: "",
    profile: "",
    rdsStorageSize: 500,

    vpcCidr: vpcCidrConfig.prod,
  },
};
