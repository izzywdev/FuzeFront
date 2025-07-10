output "vpc_id" {
  description = "ID of the VPC"
  value       = aws_vpc.main.id
}

output "public_subnet_ids" {
  description = "IDs of the public subnets"
  value       = aws_subnet.public[*].id
}

output "security_group_alb_id" {
  description = "ID of the ALB security group"
  value       = aws_security_group.alb.id
}

output "security_group_ec2_id" {
  description = "ID of the EC2 security group"
  value       = aws_security_group.ec2.id
}

output "load_balancer_dns_name" {
  description = "DNS name of the load balancer"
  value       = aws_lb.main.dns_name
}

output "load_balancer_zone_id" {
  description = "Zone ID of the load balancer"
  value       = aws_lb.main.zone_id
}

output "route53_zone_id" {
  description = "Route53 zone ID"
  value       = aws_route53_zone.main.zone_id
}

output "route53_zone_name_servers" {
  description = "Route53 zone name servers"
  value       = aws_route53_zone.main.name_servers
}

output "certificate_arn" {
  description = "ARN of the ACM certificate"
  value       = aws_acm_certificate.main.arn
}

output "website_url" {
  description = "URL of the website"
  value       = "https://${var.domain_name}"
}

output "autoscaling_group_name" {
  description = "Name of the Auto Scaling Group"
  value       = aws_autoscaling_group.main.name
}

output "launch_template_id" {
  description = "ID of the launch template"
  value       = aws_launch_template.main.id
}