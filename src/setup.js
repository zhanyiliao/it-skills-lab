import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {config} from './config.js';
import {root} from './paths.js';
import {now} from './support.js';

export async function setupDatabase({seed=true,demo=false,dbConfig=config.db}={}){
  if(!/^[a-zA-Z0-9_]+$/.test(dbConfig.database))throw new Error('Invalid database name');
  const db=await mysql.createConnection({...dbConfig,database:undefined,multipleStatements:true});
  try{
    await db.query('CREATE DATABASE IF NOT EXISTS '+dbConfig.database+' CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
    await db.changeUser({database:dbConfig.database});
    const [existing]=await db.query("SHOW TABLES LIKE 'questions'");
    await db.query(await fs.readFile(path.join(root,'database/schema.sql'),'utf8'));
    if(!existing.length&&seed)await db.query(await fs.readFile(path.join(root,'database/questions-seed.sql'),'utf8'));
    if(demo){
      const [users]=await db.execute('SELECT identity FROM user WHERE username=?',['localadmin']);
      if(!users.length)await db.execute('INSERT INTO user(username,password,role,reg_time) VALUES (?,?,2,?)',
        ['localadmin',await bcrypt.hash('LocalDemo2026!',12),now()]);
    }
    const [[count]]=await db.query('SELECT COUNT(*) AS total FROM questions');
    console.log('Database ready; questions: '+count.total);
  }finally{await db.end();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  await setupDatabase({demo:process.argv.includes('--demo')});
}
