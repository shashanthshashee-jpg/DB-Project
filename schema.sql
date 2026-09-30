-- Run once:  mysql -u root -p < schema.sql
CREATE DATABASE IF NOT EXISTS vehicle_service;
USE vehicle_service;

-- Customers and service-center staff share one table; role decides access (RBAC).
CREATE TABLE IF NOT EXISTS users (
  user_id       INT PRIMARY KEY AUTO_INCREMENT,
  name          VARCHAR(100) NOT NULL,
  email         VARCHAR(150) NOT NULL UNIQUE,
  phone         VARCHAR(15),
  password_hash VARCHAR(100) NOT NULL,
  role          ENUM('customer','center') NOT NULL DEFAULT 'customer'
);

CREATE TABLE IF NOT EXISTS vehicle (
  vehicle_id      INT PRIMARY KEY AUTO_INCREMENT,
  customer_id     INT NOT NULL,
  registration_no VARCHAR(20) UNIQUE NOT NULL,
  model           VARCHAR(100),
  FOREIGN KEY (customer_id) REFERENCES users(user_id)
);

CREATE TABLE IF NOT EXISTS service (
  service_id   INT PRIMARY KEY AUTO_INCREMENT,
  service_name VARCHAR(100) NOT NULL UNIQUE,
  base_price   DECIMAL(10,2) NOT NULL
);

CREATE TABLE IF NOT EXISTS technician (
  technician_id INT PRIMARY KEY AUTO_INCREMENT,
  name          VARCHAR(100) NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS part (
  part_id   INT PRIMARY KEY AUTO_INCREMENT,
  part_name VARCHAR(100) NOT NULL UNIQUE,
  price     DECIMAL(10,2) NOT NULL,
  stock     INT NOT NULL DEFAULT 0,
  CHECK (stock >= 0)
);

CREATE TABLE IF NOT EXISTS booking (
  booking_id    INT PRIMARY KEY AUTO_INCREMENT,
  vehicle_id    INT NOT NULL,
  service_id    INT NOT NULL,
  technician_id INT NULL,
  booking_date  DATE NOT NULL,
  status        ENUM('Booked','Job card created','In service','Ready') NOT NULL DEFAULT 'Booked',
  FOREIGN KEY (vehicle_id)    REFERENCES vehicle(vehicle_id),
  FOREIGN KEY (service_id)    REFERENCES service(service_id),
  FOREIGN KEY (technician_id) REFERENCES technician(technician_id)
);
CREATE INDEX idx_booking_date   ON booking(booking_date);
CREATE INDEX idx_booking_status ON booking(status);

-- Spare parts used on a booking (unit_price is copied so old invoices never change).
CREATE TABLE IF NOT EXISTS booking_part (
  booking_id INT NOT NULL,
  part_id    INT NOT NULL,
  qty        INT NOT NULL,
  unit_price DECIMAL(10,2) NOT NULL,
  PRIMARY KEY (booking_id, part_id),
  FOREIGN KEY (booking_id) REFERENCES booking(booking_id),
  FOREIGN KEY (part_id)    REFERENCES part(part_id)
);

CREATE TABLE IF NOT EXISTS invoice (
  invoice_id INT PRIMARY KEY AUTO_INCREMENT,
  booking_id INT NOT NULL UNIQUE,
  subtotal   DECIMAL(10,2) NOT NULL,
  gst        DECIMAL(10,2) NOT NULL,
  total      DECIMAL(10,2) NOT NULL,
  paid       BOOLEAN NOT NULL DEFAULT FALSE,
  paid_at    TIMESTAMP NULL,
  FOREIGN KEY (booking_id) REFERENCES booking(booking_id)
);

CREATE TABLE IF NOT EXISTS notification (
  notification_id INT PRIMARY KEY AUTO_INCREMENT,
  user_id    INT NOT NULL,
  message    VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(user_id)
);

INSERT IGNORE INTO service (service_name, base_price) VALUES
 ('Basic service',1499),('Full service',3999),('Oil change',899),
 ('Brake repair',2499),('AC service',1899),('Wheel alignment',799);
INSERT IGNORE INTO technician (name) VALUES ('Ravi'),('Suresh'),('Imran');
INSERT IGNORE INTO part (part_name, price, stock) VALUES
 ('Engine oil (1 L)',450,20),('Oil filter',250,15),('Brake pad set',1200,8),
 ('Air filter',350,12),('Coolant (1 L)',300,10);
