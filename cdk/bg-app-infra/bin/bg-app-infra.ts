#!/usr/bin/env node
import * as cdk from "aws-cdk-lib/core";
import { NetworkStack } from "../lib/stacks/network-stack";
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

// // ── Network Stack — always deployed first ──────────────────────────
const net = new NetworkStack(app, `${prefix}-NetworkStack`, { env, cfg });
