output "vpc_id" {
  description = "ID of the VPC"
  value       = data.aws_vpc.default.id
}

output "public_subnet_ids" {
  description = "IDs of the public subnets"
  value       = data.aws_subnets.default.ids
}

output "security_group_alb_id" {
  description = "ID of the ALB security group"
  value       = local.alb_security_group_id
}

output "security_group_ec2_id" {
  description = "ID of the EC2 security group"
  value       = local.ec2_security_group_id
}

output "load_balancer_dns_name" {
  description = "DNS name of the load balancer"
  value       = local.load_balancer_dns_name
}

output "load_balancer_zone_id" {
  description = "Zone ID of the load balancer"
  value       = local.load_balancer_zone_id
}

output "route53_zone_id" {
  description = "Route53 zone ID"
  value       = null
}

output "route53_zone_name_servers" {
  description = "Route53 zone name servers"
  value       = []
}

output "certificate_arn" {
  description = "ARN of the ACM certificate"
  value       = null
}

output "website_url" {
  description = "URL of the website"
  value       = "https://${var.domain_name}"
}

output "autoscaling_group_name" {
  description = "Name of the Auto Scaling Group"
  value       = data.aws_autoscaling_group.main.name
}

output "launch_template_id" {
  description = "ID of the launch template"
  value       = aws_launch_template.main.id
}