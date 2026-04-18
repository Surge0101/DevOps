# Current Architecture

This diagram reflects the infrastructure currently defined by the CDK code in:

- `lib/stacks/network-stack.ts`
- `lib/config.ts`

Editable diagram:

- `docs/current-architecture.drawio`

What it captures:

- `shared` VPC in account `084847996201`
- `dev` VPC in account `611411463255`
- Transit Gateway creation and RAM sharing from `shared`
- TGW attachment and routing between `shared` and `dev`
- Private isolated subnet design
- Interface and gateway VPC endpoints
- Test EC2 instances used for SSM access and TGW connectivity validation

Notes:

- No public subnets, NAT gateways, or Internet Gateway are defined in this stack.
- `prod` exists in config and is shown in the draw.io file as a configured but not TGW-connected environment.
