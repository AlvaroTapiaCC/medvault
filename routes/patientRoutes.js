const express = require("express");

module.exports = ({ pool, requireAuth }) => {
  const router = express.Router();
  const requireAdmin = (req, res, next) => {
    if (req.session.role !== "admin") {
      return res.status(403).json({ error: "Acceso restringido a administradores" });
    }
    next();
  };

  /**
   * GET /users - Listar todos los usuarios
   * Requiere autenticación y rol admin.
   */
  router.get("/users", requireAuth, requireAdmin, async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT user_id, email, full_name, role, is_active
         FROM users
         ORDER BY full_name ASC`
      );

      return res.json(result.rows);
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });

  /**
   * POST /users - Crear nuevo usuario
   * Requiere autenticación y rol admin.
   */
  router.post("/users", requireAuth, requireAdmin, async (req, res) => {
    const { email, full_name, role, password_plain, is_active } = req.body;

    if (!email || !full_name || !role || !password_plain) {
      return res.status(400).json({ error: "Faltan campos requeridos: email, full_name, role, password_plain" });
    }

    if (role === "admin") {
      return res.status(400).json({ error: "No está permitido crear usuarios con rol admin" });
    }

    try {
      const existsResult = await pool.query(
        "SELECT user_id FROM users WHERE email = $1",
        [email]
      );

      if (existsResult.rows.length > 0) {
        return res.status(400).json({ error: "Ya existe un usuario con ese email" });
      }

      const countResult = await pool.query("SELECT COUNT(*)::int as count FROM users");
      const newUserId = `U${String(countResult.rows[0].count + 1).padStart(4, "0")}`;

      const insertResult = await pool.query(
        `INSERT INTO users (user_id, email, full_name, role, password_plain, is_active)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING user_id, email, full_name, role, is_active`,
        [newUserId, email, full_name, role, password_plain, is_active ? 1 : 0]
      );

      return res.status(201).json({ success: true, user: insertResult.rows[0] });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });

  /**
   * DELETE /users/:id - Eliminar un usuario
   * Requiere autenticación y rol admin.
   */
  router.delete("/users/:id", requireAuth, requireAdmin, async (req, res) => {
    const userId = req.params.id;

    if (userId === req.session.userId) {
      return res.status(400).json({ error: "No puedes eliminar tu propio usuario administrador" });
    }

    try {
      const targetResult = await pool.query(
        "SELECT user_id, role FROM users WHERE user_id = $1",
        [userId]
      );

      if (targetResult.rows.length === 0) {
        return res.status(404).json({ error: "Usuario no encontrado" });
      }

      if (targetResult.rows[0].role === "admin") {
        return res.status(400).json({ error: "No está permitido eliminar usuarios admin" });
      }

      await pool.query("DELETE FROM users WHERE user_id = $1", [userId]);

      return res.json({ success: true });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /users/doctors - Listar usuarios con rol doctor
   * Requiere autenticación.
   */
  router.get("/users/doctors", requireAuth, async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT user_id, full_name, email
         FROM users
         WHERE role = 'doctor' AND is_active = 1
         ORDER BY full_name ASC`
      );

      return res.json(result.rows);
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });

  // ============================================================================
  // ENDPOINTS DE PACIENTES (Gestión de Pacientes - Entrega 1.1)
  // ============================================================================

  /**
   * GET /patients - Listar todos los pacientes
   * Requiere autenticación.
   */
  router.get("/patients", requireAuth, async (req, res) => {
    try {
      const result = await pool.query(
        "SELECT patient_id, national_id, full_name, sex, birth_date, phone, address, insurance, notes FROM patients ORDER BY full_name ASC"
      );
      return res.json(result.rows);
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /patients/:id - Obtener detalle de un paciente
   * Requiere autenticación.
   */
  router.get("/patients/:id", requireAuth, async (req, res) => {
    const patientId = req.params.id;

    try {
      const result = await pool.query(
        `SELECT patient_id, national_id, full_name, sex, birth_date, phone, address, insurance, notes
         FROM patients
         WHERE patient_id = $1`,
        [patientId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Paciente no encontrado" });
      }

      return res.json(result.rows[0]);
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });

  /**
   * PATCH /patients/:id/notes - Actualizar notas de un paciente
   * Requiere autenticación.
   */
  router.patch("/patients/:id/notes", requireAuth, async (req, res) => {
    const patientId = req.params.id;
    const { notes } = req.body;

    try {
      const result = await pool.query(
        `UPDATE patients
         SET notes = $1, updated_at = CURRENT_TIMESTAMP
         WHERE patient_id = $2
         RETURNING patient_id, notes`,
        [notes || null, patientId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Paciente no encontrado" });
      }

      return res.json({ success: true, patient: result.rows[0] });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });

  /**
   * POST /patients - Crear nuevo paciente
   * Requiere autenticación.
   */
  router.post("/patients", requireAuth, async (req, res) => {
    const { full_name, national_id, birth_date, sex, phone, address, insurance, notes } = req.body;

    // Validación básica
    if (!full_name || !national_id || !birth_date) {
      return res.status(400).json({ error: "Faltan campos requeridos: full_name, national_id, birth_date" });
    }

    try {
      // Generar un nuevo patient_id (formato P000XXX)
      const countResult = await pool.query("SELECT COUNT(*) as count FROM patients");
      const newId = `P${String(countResult.rows[0].count + 1).padStart(6, "0")}`;

      const result = await pool.query(
        `INSERT INTO patients (patient_id, national_id, full_name, sex, birth_date, phone, address, insurance, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [newId, national_id, full_name, sex || "X", birth_date, phone || null, address || null, insurance || null, notes || null]
      );

      // Crear la ficha clínica automáticamente
      await pool.query(
        "INSERT INTO clinical_files (patient_id) VALUES ($1)",
        [newId]
      );

      return res.status(201).json({ success: true, patient: result.rows[0] });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });

  // ============================================================================
  // ENDPOINTS DE FICHAS CLÍNICAS (Gestión de Ficha Clínica - Entrega 1.1)
  // ============================================================================

  /**
   * GET /patients/:id/records - Obtener historial de atenciones clínicas de un paciente
   * Requiere autenticación.
   */
  router.get("/patients/:id/records", requireAuth, async (req, res) => {
    const patientId = req.params.id;

    try {
      // Obtener la ficha clínica del paciente
      const fileResult = await pool.query(
        "SELECT file_id FROM clinical_files WHERE patient_id = $1",
        [patientId]
      );

      if (fileResult.rows.length === 0) {
        return res.status(404).json({ error: "Ficha clínica no encontrada" });
      }

      const fileId = fileResult.rows[0].file_id;

      // Obtener todas las atenciones de esa ficha en orden cronológico
      const recordsResult = await pool.query(
        `SELECT ma.record_id, ma.visit_date, ma.diagnosis, ma.observations, ma.doctor_id, u.full_name as doctor_name
         FROM medical_atentions ma
         LEFT JOIN users u ON ma.doctor_id = u.user_id
         WHERE ma.file_id = $1
         ORDER BY ma.visit_date DESC`,
        [fileId]
      );

      return res.json(recordsResult.rows);
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });

  /**
   * POST /patients/:id/records - Crear nueva atención clínica para un paciente
   * Requiere autenticación.
   */
  router.post("/patients/:id/records", requireAuth, async (req, res) => {
    const patientId = req.params.id;
    const { visit_date, diagnosis, observations, doctor_id } = req.body;
    const isCurrentUserDoctor = req.session.role === "doctor";
    const doctorId = isCurrentUserDoctor ? req.session.userId : doctor_id;

    // Validación básica
    if (!visit_date || !diagnosis) {
      return res.status(400).json({ error: "Faltan campos requeridos: visit_date, diagnosis" });
    }

    if (!doctorId) {
      return res.status(400).json({ error: "Debe especificar el doctor asociado" });
    }

    try {
      // Validar que el doctor exista y tenga rol doctor
      const doctorResult = await pool.query(
        `SELECT user_id
         FROM users
         WHERE user_id = $1 AND role = 'doctor' AND is_active = 1`,
        [doctorId]
      );

      if (doctorResult.rows.length === 0) {
        return res.status(400).json({ error: "Doctor seleccionado no válido" });
      }

      // Obtener la ficha clínica del paciente
      const fileResult = await pool.query(
        "SELECT file_id FROM clinical_files WHERE patient_id = $1",
        [patientId]
      );

      if (fileResult.rows.length === 0) {
        return res.status(404).json({ error: "Ficha clínica no encontrada" });
      }

      const fileId = fileResult.rows[0].file_id;

      // Insertar la nueva atención
      const result = await pool.query(
        `INSERT INTO medical_atentions (file_id, doctor_id, visit_date, diagnosis, observations)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [fileId, doctorId, visit_date, diagnosis, observations || null]
      );

      return res.status(201).json({ success: true, record: result.rows[0] });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });

  return router;
};
