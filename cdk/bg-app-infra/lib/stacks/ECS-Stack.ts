import * as cdk from "aws-cdk-lib/core";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import * as rds from "aws-cdk-lib/aws-rds";
import { Construct } from "constructs";
import { EnvConfig } from "../config";

interface ECSStackProps extends cdk.StackProps {
  cfg: EnvConfig;
  vpc: ec2.Vpc;
  albSg: ec2.SecurityGroup;
  ecsSg: ec2.SecurityGroup;
  dbInstance: rds.DatabaseInstance;
}

export class ECSStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ECSStackProps) {
    super(scope, id, props);

    const { cfg, vpc, albSg, ecsSg, dbInstance } = props;

    // ── ECR Repository ─────────────────────────────────────────────────────────
    const repo = new ecr.Repository(this, "AppRepo", {
      repositoryName: `${cfg.envName}-spring-app`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      emptyOnDelete: true,
    });

    // ── ECS Cluster ────────────────────────────────────────────────────────────
    const cluster = new ecs.Cluster(this, "Cluster", {
      vpc,
      clusterName: `${cfg.envName}-cluster`,
    });

    // ── IAM Roles ──────────────────────────────────────────────────────────────
    const executionRole = new iam.Role(this, "TaskExecutionRole", {
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "service-role/AmazonECSTaskExecutionRolePolicy",
        ),
      ],
    });

    // Allow ECS to pull the DB secret for env-var injection
    dbInstance.secret!.grantRead(executionRole);

    const taskRole = new iam.Role(this, "TaskRole", {
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
    });

    // ── Log Group ──────────────────────────────────────────────────────────────
    const logGroup = new logs.LogGroup(this, "AppLogGroup", {
      logGroupName: `/${cfg.envName}/ecs/spring-app`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // ── Task Definition ────────────────────────────────────────────────────────
    const taskDef = new ecs.FargateTaskDefinition(this, "TaskDef", {
      cpu: 512,
      memoryLimitMiB: 1024,
      executionRole,
      taskRole,
    });

    taskDef.addContainer("AppContainer", {
      image: ecs.ContainerImage.fromEcrRepository(repo, "latest"),
      portMappings: [{ containerPort: cfg.ecsAppPort }],
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: "spring-app",
        logGroup,
      }),
      // Credentials injected at runtime — available as SPRING_DATASOURCE_USERNAME/PASSWORD
      secrets: {
        SPRING_DATASOURCE_USERNAME: ecs.Secret.fromSecretsManager(
          dbInstance.secret!,
          "username",
        ),
        SPRING_DATASOURCE_PASSWORD: ecs.Secret.fromSecretsManager(
          dbInstance.secret!,
          "password",
        ),
      },
      environment: {
        SPRING_DATASOURCE_URL: `jdbc:postgresql://${dbInstance.dbInstanceEndpointAddress}:${dbInstance.dbInstanceEndpointPort}/appdb`,
        SPRING_PROFILES_ACTIVE: cfg.envName,
      },
      healthCheck: {
        command: [
          "CMD-SHELL",
          `curl -f http://localhost:${cfg.ecsAppPort}/health || exit 1`,
        ],
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        retries: 3,
        startPeriod: cdk.Duration.seconds(60), // Spring Boot startup grace period
      },
    });

    // ── Fargate Service ────────────────────────────────────────────────────────
    const service = new ecs.FargateService(this, "Service", {
      cluster,
      taskDefinition: taskDef,
      desiredCount: 1,
      securityGroups: [ecsSg],
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      assignPublicIp: false,
    });

    // ── Application Load Balancer ──────────────────────────────────────────────
    const alb = new elbv2.ApplicationLoadBalancer(this, "Alb", {
      vpc,
      internetFacing: true,
      securityGroup: albSg,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      loadBalancerName: `${cfg.envName}-alb`,
    });

    const targetGroup = new elbv2.ApplicationTargetGroup(this, "TargetGroup", {
      vpc,
      port: cfg.ecsAppPort,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.IP,
      healthCheck: {
        path: "/health",
        healthyHttpCodes: "200",
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 3,
      },
      deregistrationDelay: cdk.Duration.seconds(30),
    });

    service.attachToApplicationTargetGroup(targetGroup);

    alb.addListener("HttpListener", {
      port: 80,
      defaultAction: elbv2.ListenerAction.forward([targetGroup]),
    });

    // ── Outputs ────────────────────────────────────────────────────────────────
    new cdk.CfnOutput(this, "AlbDnsName", {
      value: alb.loadBalancerDnsName,
      description: "ALB DNS — curl http://<dns>/health to verify DB connectivity",
    });

    new cdk.CfnOutput(this, "EcrRepoUri", {
      value: repo.repositoryUri,
      description: "ECR repository URI for docker push",
    });
  }
}
