output "vpc_id" {
  description = "ID of the VPC"
  value       = data.aws_vpc.default.id
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
  value       = data.aws_lb.main.dns_name
}

output "load_balancer_zone_id" {
  description = "Zone ID of the load balancer"
  value       = data.aws_lb.main.zone_id
}

output "website_url" {
  description = "URL of the website"
  value       = "http://${data.aws_lb.main.dns_name}"
}

output "autoscaling_group_name" {
  description = "Name of the Auto Scaling Group"
  value       = data.aws_autoscaling_group.main.name
}

output "launch_template_id" {
  description = "ID of the launch template"
  value       = aws_launch_template.main.id
}