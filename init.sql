-- DELETE TABLES IF THEY EXIST --
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS patients;
DROP TABLE IF EXISTS clinical_files;
DROP TABLE IF EXISTS medical_atentions;
DROP TABLE IF EXISTS documents;
DROP TABLE IF EXISTS patient_documents;

-- CREATE TABLES --
CREATE TABLE users (
  user_id VARCHAR(10) PRIMARY KEY,
  email VARCHAR(150) NOT NULL UNIQUE,
  full_name VARCHAR(150) NOT NULL,
  role VARCHAR(20) NOT NULL CHECK (role IN ('admin', 'doctor', 'patient', 'nurse', 'staff')),
  password_plain VARCHAR(100) NOT NULL,
  is_active INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE patients (
    patient_id VARCHAR(10) PRIMARY KEY,
    national_id VARCHAR(50) NOT NULL UNIQUE,
    full_name VARCHAR(150) NOT NULL,
    sex CHAR(1) CHECK (sex IN ('M', 'F', 'X')),
    birth_date DATE NOT NULL,
    phone VARCHAR(20),
    address TEXT,
    insurance VARCHAR(50),
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE clinical_files (
    file_id SERIAL PRIMARY KEY,
    patient_id VARCHAR(10) NOT NULL UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (patient_id) REFERENCES patients(patient_id) ON DELETE CASCADE
);

CREATE TABLE medical_atentions (
    record_id SERIAL PRIMARY KEY,
    file_id INTEGER NOT NULL,
    doctor_id VARCHAR(10) NOT NULL,
    visit_date DATE NOT NULL,
    diagnosis TEXT NOT NULL,
    observations TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (file_id) REFERENCES clinical_files(file_id) ON DELETE CASCADE,
    FOREIGN KEY (doctor_id) REFERENCES users(user_id) ON DELETE RESTRICT
);

CREATE TABLE documents (
    doc_id VARCHAR(10) PRIMARY KEY,
    doc_type VARCHAR(50) NOT NULL CHECK (doc_type IN ('imaging', 'discharge', 'referral', 'prescription', 'lab')),
    doc_date DATE NOT NULL,
    title VARCHAR(255) NOT NULL,
    patient_id VARCHAR(10) NOT NULL,
    filename VARCHAR(255) NOT NULL,
    sha256 VARCHAR(64) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (patient_id) REFERENCES patients(patient_id) ON DELETE CASCADE
);

CREATE TABLE patient_documents (
    patient_id VARCHAR(10) NOT NULL,
    doc_id VARCHAR(10) NOT NULL,
    associated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (patient_id, doc_id),
    FOREIGN KEY (patient_id) REFERENCES patients(patient_id) ON DELETE CASCADE,
    FOREIGN KEY (doc_id) REFERENCES documents(doc_id) ON DELETE CASCADE
);

-- INSERT INITIAL DATA --
COPY users (user_id, email, full_name, role, password_plain, is_active)
FROM '/app/files/grupo19_users.csv'
WITH (FORMAT csv, HEADER, DELIMITER ',', NULL '', ESCAPE '"');

COPY patients (patient_id, national_id, full_name, sex, birth_date, phone, address, insurance, notes)
FROM '/app/files/grupo19_patients.csv'
WITH (FORMAT csv, HEADER, DELIMITER ',', NULL '', ESCAPE '"');

INSERT INTO clinical_files (patient_id)
SELECT DISTINCT patient_id FROM patients
ON CONFLICT (patient_id) DO NOTHING;

COPY documents (doc_id, doc_type, doc_date, title, patient_id, filename, sha256)
FROM '/app/files/grupo19_documents.csv'
WITH (FORMAT csv, HEADER, DELIMITER ',', NULL '', ESCAPE '"');

COPY patient_documents (patient_id, doc_id)
FROM '/app/files/grupo19_manifest_patient_docs.csv'
WITH (FORMAT csv, HEADER, DELIMITER ',', NULL '', ESCAPE '"');
