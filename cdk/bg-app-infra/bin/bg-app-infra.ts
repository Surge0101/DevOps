#!/usr/bin/env node
import * as cdk from "aws-cdk-lib/core";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import { NetworkStack } from "../lib/stacks/network-stack";
import { VpnStack } from "../lib/stacks/VPN-stack";
import { RDSStack } from "../lib/stacks/RDS-stack";
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
let rdsStack: RDSStack | undefined;
if (deployRds && cfg.envName === "dev" && cfg.rdsConfig) {
  rdsStack = new RDSStack(app, `${prefix}-RDSStack`, {
    env,
    cfg,
    vpc: net.vpc,
    // ecsSecurityGroup: ecs.service.connections.securityGroups[0],  // wire in once ECS stack exists
  });
}

// ── VPN Stack — dev only, deployed only when testing DB connectivity ────────
// Deploy with: cdk deploy -c env=dev -c deployVpn=true DEV-VpnStack
// If RDS is also deployed, run both together so the VPN CIDR rule lands on the RDS SG:
//   cdk deploy -c env=dev -c deployRds=true -c deployVpn=true DEV-RDSStack DEV-VpnStack
const deployVpn = app.node.tryGetContext("deployVpn") === "true";
if (deployVpn && cfg.envName === "dev") {
  const vpnUsers = ((app.node.tryGetContext("vpnUsers") as string | undefined) ?? "user1")
    .split(",")
    .map((u) => u.trim());

  const vpn = new VpnStack(app, `${prefix}-VpnStack`, {
    env,
    cfg,
    vpc: net.vpc,
    users: vpnUsers,
  });

  // Open RDS port 5432 to VPN clients — adds a CIDR ingress rule to the RDS SG
  if (rdsStack) {
    rdsStack.dbInstance.connections.allowFrom(
      ec2.Peer.ipv4(vpn.vpnClientCidr),
      ec2.Port.tcp(5432),
      "VPN clients",
    );
  }
}
