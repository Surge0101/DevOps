import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as targets from "aws-cdk-lib/aws-elasticloadbalancingv2-targets";
import * as targets53 from "aws-cdk-lib/aws-route53-targets";
import * as actions from "aws-cdk-lib/aws-elasticloadbalancingv2-actions";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as iam from "aws-cdk-lib/aws-iam";

export interface MainStackProps extends cdk.StackProps {
  domainName: string;
  dashboardFqdn: string; // allure.example.com
  loginSub: string; // allurelogin
  loginFqdn: string; // allurelogin.example.com
  cognitoCustomDomainCertARN: string;
  cognitoCloudFrontFqdn: string;
}

export class MainStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: MainStackProps) {
    super(scope, id, props);

    const zone = route53.HostedZone.fromLookup(this, "Zone", {
      domainName: props.domainName,
    });

    // 1. Create the Private S3 Bucket
    const reportBucket = new s3.Bucket(this, "AllureReportBucket", {
      versioned: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL, // Keep it private
      removalPolicy: cdk.RemovalPolicy.DESTROY, // Change to RETAIN for production
      autoDeleteObjects: true,
    });

    const parentDomainRecord = new route53.ARecord(
      this,
      "AllurereportCognitoDummyDomainRecord",
      {
        zone: zone,
        target: route53.RecordTarget.fromIpAddresses("192.0.2.1"), //TEST-NET Dummy IP
        recordName: "",
      },
    );
    // 1. Certificate for the ALB (Sydney region)
    const albCert = new acm.Certificate(this, "AlbCert", {
      domainName: props.dashboardFqdn,
      validation: acm.CertificateValidation.fromDns(zone),
    });

    const customCognitoDomainCert = acm.Certificate.fromCertificateArn(
      this,
      "CustomCognitoDomainCert",
      props.cognitoCustomDomainCertARN,
    );

    // 2. Cognito Configuration
    const userPool = new cognito.UserPool(this, "UserPool", {
      userPoolName: "allure-viewer-users",
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      autoVerify: { email: true },
      passwordPolicy: {
        minLength: 12,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
      },
    });

    const userPoolClient = userPool.addClient("UserPoolClient", {
      generateSecret: true, // Required for ALB
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL],
        // The /oauth2/idpresponse endpoint is handled automatically by the ALB
        callbackUrls: [`https://${props.dashboardFqdn}/oauth2/idpresponse`],
        logoutUrls: [`https://${props.dashboardFqdn}/logout`],
      },
    });

    // Custom Cognito domain: allurereportlogin.brandon-gm.com
    const userPoolDomain = userPool.addDomain("UserPoolDomain", {
      customDomain: {
        domainName: props.loginFqdn,
        certificate: customCognitoDomainCert,
      },
    });

    userPoolDomain.node.addDependency(parentDomainRecord); // Ensure the parent domain record exists before creating the custom domain

    new route53.CnameRecord(this, "CofnitoDomainCname", {
      zone: zone,
      recordName: "allurereportlogin", // allurelogin
      domainName: props.cognitoCloudFrontFqdn, // Cognito custom domain (e.g., allurelogin.example.com)
    });
    // 3. Static Page Lambda
    const staticPageLambda = new lambda.Function(this, "StaticPageLambda", {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: "index.handler",
      code: lambda.Code.fromAsset("./lambda"),
      environment: {
        BUCKET_NAME: reportBucket.bucketName,
        OBJECT_KEY: "index.html",
      },
    });

    // Assuming `staticPageLambda` is your Lambda function
    reportBucket.grantRead(staticPageLambda);

    // 4. ALB and VPC
    const vpc = new ec2.Vpc(this, "Vpc", { maxAzs: 2 });
    const alb = new elbv2.ApplicationLoadBalancer(this, "ALB", {
      vpc,
      internetFacing: true,
    });

    // 5. ALB Listener with Cognito Authentication
    const listener = alb.addListener("HttpsListener", {
      port: 443,
      certificates: [albCert],
    });

    listener.addAction("CognitoAuth", {
      action: new actions.AuthenticateCognitoAction({
        userPool,
        userPoolClient,
        userPoolDomain,
        // After auth, forward to the Lambda
        next: elbv2.ListenerAction.forward([
          new elbv2.ApplicationTargetGroup(this, "LambdaTG", {
            vpc,
            targets: [new targets.LambdaTarget(staticPageLambda)],
          }),
        ]),
      }),
    });

    // Redirect HTTP to HTTPS
    alb.addRedirect();

    // 6. Route 53 A Record
    new route53.ARecord(this, "AliasRecord", {
      zone,
      recordName: "allurereport",
      target: route53.RecordTarget.fromAlias(
        new targets53.LoadBalancerTarget(alb),
      ),
    });
  }
}
