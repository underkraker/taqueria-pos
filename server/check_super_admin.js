const { db, initDb } = require('./database');

const checkUser = async () => {
    await initDb();
    db.get(`SELECT * FROM users WHERE username = 'adminuniv'`, (err, row) => {
        if (err) {
            console.error('Error querying user:', err.message);
        } else if (row) {
            console.log('User found:', JSON.stringify(row, null, 2));
        } else {
            console.log('User NOT found');
        }
    });
};

checkUser();
