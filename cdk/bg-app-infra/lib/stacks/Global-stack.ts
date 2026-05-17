import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as route53 from "aws-cdk-lib/aws-route53";

// ── Global Stack ───────────────────────────────────────────────────────────────
// Runs in the root/management account.
// Adds an NS record to the root hosted zone so traffic for
// <subdomain>.brandon-gm.com resolves to the env-owned zone.
//
// Deploy order:
//   1. cdk deploy <ENV>-DNSStack --profile bg-<env>   → copy ZoneNs output
//   2. cdk deploy <ENV>-GlobalStack -c zoneNs=<value> --profile bg-root

export interface GlobalStackProps extends cdk.StackProps {
  domainName: string;    // "brandon-gm.com"
  hostedZoneId: string;  // root zone ID in management account
  subdomain: string;     // "dev" | "prod"
  nsRecords: string[];   // NS values from DNSStack ZoneNs output
}

export class GlobalStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: GlobalStackProps) {
    super(scope, id, props);

    const rootZone = route53.HostedZone.fromHostedZoneAttributes(this, "RootZone", {
      hostedZoneId: props.hostedZoneId,
      zoneName: props.domainName,
    });

    new route53.NsRecord(this, "Delegation", {
      zone: rootZone,
      recordName: props.subdomain,
      values: props.nsRecords,
      ttl: cdk.Duration.hours(24),
    });
  }
}
