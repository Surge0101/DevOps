#!/usr/bin/env node
import * as cdk from "aws-cdk-lib/core";
import { OrgAccountsStack } from "../lib/org-accounts-stack";

const app = new cdk.App();

new OrgAccountsStack(app, "OrgAccountsStack", {});
