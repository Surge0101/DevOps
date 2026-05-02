import * as cdk from "aws-cdk-lib";
import { GlobalStack } from "../lib/global-stack";
import { MainStack } from "../lib/main-stack";
import * as cognito from "aws-cdk-lib/aws-cognito";
import { Construct } from "constructs";
import * as ssm from "aws-cdk-lib/aws-ssm";

const app = new cdk.App();

const domainName = app.node.tryGetContext("domainName") ?? "brandon-gm.com";
const dashboardSub = app.node.tryGetContext("dashboardSub") ?? "allurereport";
const loginSub = app.node.tryGetContext("loginSub") ?? "allurereportlogin";
const cognitoCustomDomainCertARN =
  "arn:aws:acm:us-east-1:448658736684:certificate/10334b35-2a28-4c1a-bed5-328e62dcb713";

const cognitoCloudFrontFqdn = "d2p6mzu2nvx7k2.cloudfront.net";
const dashboardFqdn = `${dashboardSub}.${domainName}`;
const loginFqdn = `${loginSub}.${domainName}`;

const account = process.env.CDK_DEFAULT_ACCOUNT!;
const region = process.env.CDK_DEFAULT_REGION!;

// Phase 2: Global (us-east-1) for CloudFront cert
const globalStack = new GlobalStack(app, "AllureViewer-Global", {
  env: { account, region: "us-east-1" },
  domainName,
  dashboardFqdn,
  loginFqdn,
});

const mainStack = new MainStack(app, "AllureViewer-Main", {
  env: { account, region: region },
  domainName,
  dashboardFqdn,
  loginFqdn,
  loginSub,
  cognitoCustomDomainCertARN,
  cognitoCloudFrontFqdn,
});
