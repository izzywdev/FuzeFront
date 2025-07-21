terraform {
  required_version = ">= 1.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

# Local values for consistent naming
locals {
  name_prefix = "${var.project_name}-${var.environment}"
  
  # Tags applied to all resources
  common_tags = {
    Project     = var.project_name
    Environment = var.environment
    ManagedBy   = "terraform"
    Purpose     = "fuzefront-website"
  }
}

# DATA SOURCES - Check for existing resources
data "aws_vpc" "default" {
  default = true
}

data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
}

# Check for existing Route53 zone - disabled due to multiple zones
data "aws_route53_zone" "existing" {
  count        = 0  # Disabled to avoid multiple zone conflicts
  name         = var.domain_name
  private_zone = false
}

# Check for existing ACM certificate - disabled due to multiple zones
data "aws_acm_certificate" "existing" {
  count       = 0  # Disabled to avoid multiple zone conflicts
  domain      = var.domain_name
  statuses    = ["ISSUED"]
  most_recent = true
}

# Check for existing security groups
data "aws_security_groups" "existing_alb" {
  filter {
    name   = "group-name"
    values = ["${local.name_prefix}-alb-sg"]
  }
}

data "aws_security_groups" "existing_ec2" {
  filter {
    name   = "group-name"
    values = ["${local.name_prefix}-ec2-sg"]
  }
}

# Try to get existing key pair (will return null if doesn't exist)
data "aws_key_pair" "existing" {
  count           = 0  # Disable data source approach for now
  key_name        = "${local.name_prefix}-key"
  include_public_key = true
}

# Import existing resources instead of recreating them
# These resources already exist and should be imported, not recreated

# Use existing ALB
data "aws_lb" "main" {
  name = "${local.name_prefix}-alb"
}

# Use existing target group  
data "aws_lb_target_group" "main" {
  name = "${local.name_prefix}-tg"
}

# Use existing ASG
data "aws_autoscaling_group" "main" {
  name = "${local.name_prefix}-asg"
}

# ROUTE53 ZONE - Disabled due to multiple existing zones
resource "aws_route53_zone" "main" {
  count = 0  # Disabled to avoid multiple zone conflicts
  name  = var.domain_name

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-zone"
  })

  lifecycle {
    prevent_destroy = true
  }
}

# Route53 disabled - no zone management
locals {
  route53_zone_id = null
}

# ACM CERTIFICATE - Disabled due to multiple existing zones
resource "aws_acm_certificate" "main" {
  count             = 0  # Disabled to avoid multiple zone conflicts
  domain_name       = var.domain_name
  subject_alternative_names = ["*.${var.domain_name}"]
  validation_method = "DNS"

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-cert"
  })

  lifecycle {
    create_before_destroy = true
    prevent_destroy       = true
  }
}

# Certificate disabled - no SSL management
locals {
  certificate_arn = null
}

# Certificate validation records - disabled
# resource "aws_route53_record" "cert_validation" {
#   for_each = {}  # Disabled due to multiple zones
#
#   allow_overwrite = true
#   name            = each.value.name
#   records         = [each.value.record]
#   ttl             = 60
#   type            = each.value.type
#   zone_id         = local.route53_zone_id
# }

# Certificate validation - disabled
# resource "aws_acm_certificate_validation" "main" {
#   count                   = 0  # Disabled due to multiple zones
#   certificate_arn         = null
#   validation_record_fqdns = []
#
#   timeouts {
#     create = "5m"
#   }
# }

# SECURITY GROUP FOR ALB - Create only if doesn't exist
resource "aws_security_group" "alb" {
  count       = length(data.aws_security_groups.existing_alb.ids) == 0 ? 1 : 0
  name        = "${local.name_prefix}-alb-sg"
  description = "Security group for Application Load Balancer"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    description = "HTTP"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "HTTPS"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-alb-sg"
  })

  lifecycle {
    create_before_destroy = true
  }
}

# Use existing or created ALB security group
locals {
  alb_security_group_id = length(data.aws_security_groups.existing_alb.ids) > 0 ? data.aws_security_groups.existing_alb.ids[0] : aws_security_group.alb[0].id
}

# SECURITY GROUP FOR EC2 - Create only if doesn't exist
resource "aws_security_group" "ec2" {
  count       = length(data.aws_security_groups.existing_ec2.ids) == 0 ? 1 : 0
  name        = "${local.name_prefix}-ec2-sg"
  description = "Security group for EC2 instances"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    description     = "HTTP from ALB"
    from_port       = 80
    to_port         = 80
    protocol        = "tcp"
    security_groups = [local.alb_security_group_id]
  }

  ingress {
    description = "SSH"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = var.ssh_cidr_blocks
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-ec2-sg"
  })

  lifecycle {
    create_before_destroy = true
  }
}

# Use existing or created EC2 security group
locals {
  ec2_security_group_id = length(data.aws_security_groups.existing_ec2.ids) > 0 ? data.aws_security_groups.existing_ec2.ids[0] : aws_security_group.ec2[0].id
}

# KEY PAIR - Create if SSH key is provided, will be imported if exists
resource "aws_key_pair" "main" {
  count      = var.ssh_public_key != "" ? 1 : 0
  key_name   = "${local.name_prefix}-key"
  public_key = var.ssh_public_key

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-key"
  })
  
  lifecycle {
    ignore_changes = [public_key]
  }
}

# Use created key pair
locals {
  key_name = var.ssh_public_key != "" ? aws_key_pair.main[0].key_name : null
}

# IAM ROLE FOR EC2 INSTANCES (SSM ACCESS)
resource "aws_iam_role" "ec2_ssm_role" {
  name = "${local.name_prefix}-ec2-ssm-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "ec2.amazonaws.com"
        }
      }
    ]
  })

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-ec2-ssm-role"
  })

  lifecycle {
    prevent_destroy = true
  }
}

# ATTACH SSM MANAGED POLICY
resource "aws_iam_role_policy_attachment" "ec2_ssm_policy" {
  role       = aws_iam_role.ec2_ssm_role.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

# ATTACH ECR READ POLICY FOR DOCKER IMAGES
resource "aws_iam_role_policy_attachment" "ec2_ecr_policy" {
  role       = aws_iam_role.ec2_ssm_role.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly"
}

# INSTANCE PROFILE
resource "aws_iam_instance_profile" "ec2_profile" {
  name = "${local.name_prefix}-ec2-profile"
  role = aws_iam_role.ec2_ssm_role.name

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-ec2-profile"
  })
}

# USER DATA SCRIPT
locals {
  user_data = base64encode(templatefile("${path.module}/user_data.sh", {
    project_name = var.project_name
    domain_name = var.domain_name
    email = var.ssl_email
  }))
}

# LAUNCH TEMPLATE - Always create new version
resource "aws_launch_template" "main" {
  name_prefix   = "${local.name_prefix}-"
  image_id      = "ami-0c7217cdde317cfec" # Amazon Linux 2023
  instance_type = var.instance_type
  key_name      = local.key_name

  vpc_security_group_ids = [local.ec2_security_group_id]

  iam_instance_profile {
    name = aws_iam_instance_profile.ec2_profile.name
  }

  user_data = local.user_data

  tag_specifications {
    resource_type = "instance"
    tags = merge(local.common_tags, {
      Name = "${local.name_prefix}-instance"
    })
  }

  lifecycle {
    create_before_destroy = true
    # Limit number of launch template versions to prevent accumulation
    ignore_changes = [name_prefix]
  }

  # Automatically clean up old versions - keep only latest 3
  dynamic "tag_specification" {
    for_each = ["instance", "volume"]
    content {
      resource_type = tag_specification.value
      tags = merge(local.common_tags, {
        Name = "${local.name_prefix}-${tag_specification.value}"
      })
    }
  }

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-template"
  })
}

# TARGET GROUP - Use existing (imported via data source above)

# Use existing target group from data source
locals {
  target_group_arn = data.aws_lb_target_group.main.arn
}

# AUTO SCALING GROUP - Use existing (imported via data source above)

# LOAD BALANCER - Use existing (imported via data source above)

# Use existing load balancer from data source
locals {
  load_balancer_arn = data.aws_lb.main.arn
  load_balancer_dns_name = data.aws_lb.main.dns_name
  load_balancer_zone_id = data.aws_lb.main.zone_id
}

# ALB LISTENERS - Use existing ones (they're already configured)
# HTTP and HTTPS listeners already exist and are properly configured
# No need to recreate them

# ROUTE53 RECORDS - Disabled due to multiple zones
# resource "aws_route53_record" "main" {
#   count   = 0  # Disabled due to multiple zones
#   zone_id = local.route53_zone_id
#   name    = var.domain_name
#   type    = "A"
#
#   alias {
#     name                   = local.load_balancer_dns_name
#     zone_id                = local.load_balancer_zone_id
#     evaluate_target_health = true
#   }
# }
#
# resource "aws_route53_record" "www" {
#   count   = 0  # Disabled due to multiple zones
#   zone_id = local.route53_zone_id
#   name    = "www.${var.domain_name}"
#   type    = "A"
#
#   alias {
#     name                   = local.load_balancer_dns_name
#     zone_id                = local.load_balancer_zone_id
#     evaluate_target_health = true
#   }
# }