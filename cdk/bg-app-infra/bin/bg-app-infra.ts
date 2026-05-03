#!/usr/bin/env node
import * as cdk from "aws-cdk-lib/core";
import { NetworkStack } from "../lib/stacks/network-stack";
import { RDSStack } from "../lib/stacks/RDS-stack";
import { VpnStack } from "../lib/stacks/vpn-stack";
import { AppEnv, ENV_CONFIG } from "../lib/config";

const app = new cdk.App();
const envName = (app.node.tryGetContext("env") ?? "dev") as AppEnv;
const cfg = ENV_CONFIG[envName];

// if (!cfg) {
//   throw new Error(
//     `Unknown environment "${envName}". Valid values: dev | shared | prod`,
//   );
// }

const prefix = cfg.envName.toUpperCase();
const env = { account: cfg.account, region: cfg.region };

// ── Network Stack — always deployed first ──────────────────────────────────
const net = new NetworkStack(app, `${prefix}-NetworkStack`, { env, cfg });

// ── RDS Stack — dev only, deployed only when explicitly approved ───────────
// Deploy with: cdk deploy -c env=dev -c deployRds=true DEV-RDSStack
const deployRds = app.node.tryGetContext("deployRds") === "true";
if (deployRds && cfg.envName === "dev" && cfg.rdsConfig) {
  new RDSStack(app, `${prefix}-RDSStack`, {
    env,
    cfg,
    vpc: net.vpc,
    rdsSecurityGroup: net.rdsSg,
  });
}

// ── VPN Stack — optional, requires vpnConfig populated in config.ts ────────
// 1. Run easy-rsa cert setup and import certs to ACM (see README or vpn-stack.ts)
// 2. Uncomment vpnConfig in config.ts and fill in the ACM ARNs
// 3. Deploy with: cdk deploy -c env=prod -c deployVpn=true PROD-VpnStack
const deployVpn = app.node.tryGetContext("deployVpn") === "true";
if (deployVpn && cfg.vpnConfig) {
  new VpnStack(app, `${prefix}-VpnStack`, {
    env,
    cfg,
    vpc: net.vpc,
    rdsSg: net.rdsSg,
  });
}
