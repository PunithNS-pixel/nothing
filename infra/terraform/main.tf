variable "project" { type = string }
variable "cloud_name" { type = string, default = "google-europe-west1" }
variable "pg_plan" { type = string, default = "free-1" }
variable "kafka_plan" { type = string, default = "free-1" }
variable "opensearch_plan" { type = string, default = "free-1" }
variable "prefix" { type = string, default = "retail-demo" }

resource "aiven_pg" "db" {
  project = var.project
  cloud_name = var.cloud_name
  plan = var.pg_plan
  service_name = "${var.prefix}-pg"
}
resource "aiven_kafka" "events" {
  project = var.project
  cloud_name = var.cloud_name
  plan = var.kafka_plan
  service_name = "${var.prefix}-kafka"
}
resource "aiven_opensearch" "search" {
  project = var.project
  cloud_name = var.cloud_name
  plan = var.opensearch_plan
  service_name = "${var.prefix}-search"
}
# Aiven plan availability and permissible cloud locations vary by project.
# No credential outputs: obtain the client certs and URLs from Aiven console.
output "database_service" { value = aiven_pg.db.service_name }
output "kafka_service" { value = aiven_kafka.events.service_name }
output "search_service" { value = aiven_opensearch.search.service_name }
