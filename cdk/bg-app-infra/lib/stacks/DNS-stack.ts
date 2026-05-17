import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as targets from "aws-cdk-lib/aws-route53-targets";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import { EnvConfig } from "../config";

// ── DNS Stack ──────────────────────────────────────────────────────────────────
// Per-env stack. Owns the subdomain zone, ACM cert, ALB, and app A record.
// After first deploy, paste ZoneNs into bin and deploy GlobalStack
// against the management account to complete NS delegation.

export interface DnsStackProps extends cdk.StackProps {
  cfg: EnvConfig;
  zoneName: string;       // "dev.brandon-gm.com"
  appSubdomain: string;   // "api"
  appFqdn: string;        // "api.dev.brandon-gm.com"
  requiresManagementDelegation: boolean;
  vpc: ec2.Vpc;
  albSg: ec2.SecurityGroup;
  fargateService: ecs.FargateService;
}

export class DnsStack extends cdk.Stack {
  public readonly zone: route53.PublicHostedZone;
  public readonly certificate: acm.Certificate;
  public readonly alb: elbv2.ApplicationLoadBalancer;

  constructor(scope: Construct, id: string, props: DnsStackProps) {
    super(scope, id, props);

    const { cfg } = props;

    cdk.Tags.of(this).add("ManagementDelegationRequired", String(props.requiresManagementDelegation));
    cdk.Tags.of(this).add("Environment", cfg.envName);
    cdk.Tags.of(this).add("Owner", "brandon.goodman");
    cdk.Tags.of(this).add("Project", "bg-app");

    // ── Hosted Zone ────────────────────────────────────────────────────────────
    this.zone = new route53.PublicHostedZone(this, "Zone", {
      zoneName: props.zoneName,
    });

    new cdk.CfnOutput(this, "ZoneId", { value: this.zone.hostedZoneId });
    new cdk.CfnOutput(this, "ZoneNs", {
      value: cdk.Fn.join(",", this.zone.hostedZoneNameServers!),
      description: props.requiresManagementDelegation
        ? `REQUIRED: cdk deploy ${cfg.envName.toUpperCase()}-GlobalStack -c zoneNs=<value> --profile bg-root`
        : "NS records for this zone (no management delegation required)",
    });

    // ── ACM Certificate ────────────────────────────────────────────────────────
    this.certificate = new acm.Certificate(this, "AlbCert", {
      domainName: props.appFqdn,
      validation: acm.CertificateValidation.fromDns(this.zone),
    });

    // ── ALB ────────────────────────────────────────────────────────────────────
    this.alb = new elbv2.ApplicationLoadBalancer(this, "ALB", {
      vpc: props.vpc,
      securityGroup: props.albSg,
      internetFacing: true,
      loadBalancerName: `${cfg.envName}-alb`,
    });

    const targetGroup = new elbv2.ApplicationTargetGroup(this, "TG", {
      vpc: props.vpc,
      port: cfg.ecsAppPort,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.IP,
      targets: [props.fargateService],
      healthCheck: {
        path: "/actuator/health",
        healthyHttpCodes: "200",
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 3,
      },
    });

    this.alb.addListener("HttpsListener", {
      port: 443,
      certificates: [this.certificate],
      defaultAction: elbv2.ListenerAction.forward([targetGroup]),
    });

    this.alb.addRedirect();

    // ── Route 53 A Record ──────────────────────────────────────────────────────
    new route53.ARecord(this, "AliasRecord", {
      zone: this.zone,
      recordName: props.appSubdomain,
      target: route53.RecordTarget.fromAlias(new targets.LoadBalancerTarget(this.alb)),
    });

    new cdk.CfnOutput(this, "AlbDnsName", { value: this.alb.loadBalancerDnsName });
    new cdk.CfnOutput(this, "AppUrl", { value: `https://${props.appFqdn}` });
  }
}
