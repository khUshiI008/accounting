import mysql from "mysql2/promise";

const masterDB = mysql.createPool({
  host:     process.env.DB_HOST,
  user:     process.env.DB_USER,
  password: process.env.DB_PASS,
  database: "master_db",
  waitForConnections: true,
  connectionLimit: 10,
});

export default masterDB;