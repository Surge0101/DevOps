import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as acm from "aws-cdk-lib/aws-certificatemanager";

export interface GlobalStackProps extends cdk.StackProps {
  domainName: string;
  dashboardFqdn: string; // e.g. allure.example.com
  loginFqdn: string; // e.g. allurelogin.example.com
}

export class GlobalStack extends cdk.Stack {
  public readonly cloudFrontCertArn: string;

  constructor(scope: Construct, id: string, props: GlobalStackProps) {
    super(scope, id, props);

    const zone = route53.HostedZone.fromLookup(this, "Zone", {
      domainName: props.domainName,
    });

    const cert = new acm.Certificate(this, "CloudFrontCert", {
      domainName: props.dashboardFqdn,
      validation: acm.CertificateValidation.fromDns(zone),
    });

    const cognitoCustomDomainCert = new acm.Certificate(
      this,
      "CognitoCustomDomainCert",
      {
        domainName: props.loginFqdn,
        validation: acm.CertificateValidation.fromDns(zone),
      },
    );

    this.cloudFrontCertArn = cert.certificateArn;

    // new cdk.CfnOutput(this, 'CloudFrontCertArn', { value: cert.certificateArn });
    // //cognito user configuration
    //     const userPool = new cognito.UserPool(this, 'UserPool', {
    //       userPoolName: 'allure-viewer-users',
    //       selfSignUpEnabled: false,
    //       signInAliases: {
    //       email: true,
    //     },
    //     autoVerify: {
    //       email: true,
    //     },
    //     passwordPolicy: {
    //       minLength: 12,
    //       requireLowercase: true,
    //       requireUppercase: true,
    //       requireDigits: true,
    //       requireSymbols: true,
    //     },

    //   });
    //   const userPoolClient = new cognito.UserPoolClient(this, 'UserPoolClient', {
    //   userPool,
    //   authFlows: {
    //     userPassword: true,
    //     userSrp: true,
    //   },
    //   oAuth: {
    //     flows: {
    //       authorizationCodeGrant: true,
    //     },
    //     scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL],
    //     callbackUrls: [`https://${props.dashboardFqdn}/callback`],
    //     logoutUrls: [`https://${props.dashboardFqdn}/logout`],
    //   },
    // });
    //   const userPoolDomain = new cognito.UserPoolDomain(this, 'UserPoolDomain', {
    //   userPool,
    //   cognitoDomain: {
    //     domainPrefix: `allure-viewer-${cdk.Aws.ACCOUNT_ID}`, // Must be globally unique
    //   },
    // });

    // // Output the login URL
    //   new cdk.CfnOutput(this, 'LoginURL', {
    //     value: `https://${userPoolDomain.domainName}.auth.${cdk.Aws.REGION}.amazoncognito.com/login?client_id=${userPoolClient.userPoolClientId}&response_type=code&redirect_uri=https://${props.dashboardFqdn}/callback`,
    //     description: 'Cognito Hosted UI Login URL',
    // });
  }
}
