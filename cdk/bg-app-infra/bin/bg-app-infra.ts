#!/usr/bin/env node
import * as cdk from "aws-cdk-lib/core";
import { NetworkStack } from "../lib/stacks/network-stack";
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
if (deployRds && cfg.envName === "dev" && cfg.rdsConfig) {
  new RDSStack(app, `${prefix}-RDSStack`, {
    env,
    cfg,
    vpc: net.vpc,
    // ecsSecurityGroup: ecs.service.connections.securityGroups[0],  // wire in once ECS stack exists
  });
}
