#!/usr/bin/env node
import * as cdk from "aws-cdk-lib/core";
import { NetworkStack } from "../lib/stacks/network-stack";
import { RDSStack } from "../lib/stacks/RDS-stack";
import { ECSTestStack } from "../lib/stacks/ECS-Test-Stack";
import { DnsStack } from "../lib/stacks/DNS-stack";
import { GlobalStack } from "../lib/stacks/Global-stack";
import { AppEnv, ENV_CONFIG } from "../lib/config";

const app = new cdk.App();
const envName = (app.node.tryGetContext("env") ?? "dev") as AppEnv;
const cfg = ENV_CONFIG[envName];

const domainName   = app.node.tryGetContext("domainName")   ?? "brandon-gm.com";
const hostedZoneId = app.node.tryGetContext("hostedZoneId") ?? "Z03096971LLPUMEKRTSRS";

// Subdomain zone for this env: dev.brandon-gm.com, prod.brandon-gm.com, …
const zoneName     = app.node.tryGetContext("zoneName")     ?? `${cfg.envName}.${domainName}`;
const appSubdomain = app.node.tryGetContext("appSubdomain") ?? "api";
const appFqdn      = `${appSubdomain}.${zoneName}`;

// Whether this env zone needs NS delegation from the management account.
// Default true for all envs. Override with: -c requiresManagementDelegation=false
const requiresManagementDelegation =
  app.node.tryGetContext("requiresManagementDelegation") !== "false";

// NS records output by <ENV>-DNSStack (comma-separated).
// After DNSStack deploy, pass with: -c zoneNs=<ns1,ns2,...>
const zoneNs = app.node.tryGetContext("zoneNs") as string | undefined;

const prefix = cfg.envName.toUpperCase();
const env    = { account: cfg.account, region: cfg.region };

// ── Network Stack ──────────────────────────────────────────────────────────────
const net = new NetworkStack(app, `${prefix}-NetworkStack`, { env, cfg });

// ── ECS Stack — placeholder app served from ECR ────────────────────────────────
const ecsStack = new ECSTestStack(app, `${prefix}-ECSTestStack`, {
  env,
  cfg,
  vpc: net.vpc,
  ecsSg: net.ecsSg,
});

// ── RDS Stack — dev only, opt-in ───────────────────────────────────────────────
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

// ── DNS Stack — zone + cert + ALB + app record ─────────────────────────────────
// Deploy order:
//   1. cdk deploy <ENV>-DNSStack --profile bg-<env>
//        → copy ZoneNs output
//   2. cdk deploy <ENV>-GlobalStack -c zoneNs=<value> --profile bg-root
new DnsStack(app, `${prefix}-DNSStack`, {
  env,
  cfg,
  zoneName,
  appSubdomain,
  appFqdn,
  requiresManagementDelegation,
  vpc: net.vpc,
  albSg: net.albSg,
  fargateService: ecsStack.fargateService,
});

// ── Global Stack — management account, opt-in ──────────────────────────────────
// Adds NS delegation in the root zone so <env>.brandon-gm.com resolves.
// Run only after DNSStack is deployed and ZoneNs is known.
// cdk deploy <ENV>-GlobalStack -c zoneNs=<ns1,ns2,...> --profile bg-root
if (requiresManagementDelegation && zoneNs) {
  new GlobalStack(app, `${prefix}-GlobalStack`, {
    env: { account: cfg.rootAccountId, region: cfg.region },
    domainName,
    hostedZoneId,
    subdomain: cfg.envName,
    nsRecords: zoneNs.split(",").map((s) => s.trim()),
  });
}
