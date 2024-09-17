require('dotenv').config();

const express = require('express');
const cors = require('cors')

const mongoose = require('mongoose')
const userModel= require('./models/user')
const oracledb = require('oracledb')
const session = require('express-session');
const bcrypt = require('bcrypt')
const app = express();
const stripe = require("stripe")(process.env.STRIPE_KEY)
app.use(session({
    secret: 'your_very_strong_and_random_secret_key', 
    resave: false,
    saveUninitialized: true,
    cookie: { secure: true, httpOnly: true } // Set secure flags
  }));
app.use(express.json());
app.use(cors());


async function connect(){
    try{
        await mongoose.connect(process.env.MOONGOOSE_STRING);
        console.log('connect to database');
    }
    catch(error)
    {
        console.error(error);
    }
}
let pool;
const initializePool = async () => {
    let oraclePass = process.env.DB_PASSWORD;
    let oracleConnectString = process.env.ORACLE_CONNECT_STRING;
    try {
        pool = await oracledb.createPool({
            user: "admin",
            password: `${oraclePass}`,
            connectString: `${oracleConnectString}`,
            poolMax: 10, // Maximum number of connections in the pool
            poolMin: 2,  // Minimum number of connections in the pool
            poolTimeout: 60, // Time (in seconds) after which idle connections are released
            poolPingInterval: 60 // Time (in seconds) between connection pings to keep connections alive
        });
        console.log('connecting oracle database success')
    } catch (error) {
        console.error("Error initializing connection pool:", error);
    }
};
connect();
initializePool();

app.post('/register', async (req,res)=>{
    const saltRound = 10;
    try{
        // const user = await userModel.create(req.body);
        const {name,email,password} = req.body;
        const checkIfNameExisted = await userModel.findOne({name});
        const checkIfEmailExisted = await userModel.findOne({email});
        if (checkIfNameExisted) {
            console.log("username existed")
            return res.json({ message: "Username already exists" });
        }

        if (checkIfEmailExisted) {
            console.log("email existed")

            return res.json({ message: "Email already exists" });
        }

        const hashedPw = await bcrypt.hash(password,saltRound);
        const newBody = {name,email, password: hashedPw};
        const user = await userModel.create(newBody);
        res.json({message: "Success"})
    }
    catch(error)
    {
        res.status(500).json(error)
    }
})
app.post('/login', async (req,res)=>{
    const {username,password}= req.body;
    req.session.username = username

    // req.session.username= username;
    console.log('session username when login is ',req.session.username)
    console.log('username is ',username)
    console.log('password is ', password)
    try{
        const user = await userModel.findOne({name:username})
        if(user)
        {
            const isMatched = await bcrypt.compare(password, user.password);
            if(isMatched)
            {
                console.log('Logged username is ',username)
                res.status(200).json({ message:'Success'})
            }
            else
            {
                res.status(500).json({ message:'Wrong password'})
            }
        }
        else{
            res.status(500).json({message:"User not exist"})
        }
    }catch(error)
    {
        res.status(500).json(error)
    }
})

app.get('/Home', async (req,res)=>{

    let connection;
    try{
        connection = await  pool.getConnection();
        const query = "SELECT JSON_OBJECT (*) from EARBUDS";
        const result = await connection.execute(query);
        const rows = result.rows;
        res.json(rows);
    }
    catch (error) {
        console.error("Error executing SQL query:", error);
        res.status(500).json({ error: "Internal Server Error" });
    } finally {
        if (connection) {
            try {
                await connection.close();
            } catch (error) {
                console.error("Error closing connection:", error);
            }
        }
    }
 
})

app.post('/Orders', async (req,res)=>{

    let connection;
    let username = req.body.username;
    try{
        connection = await  pool.getConnection();
        const query = `SELECT JSON_OBJECT (*) from ORDERS LEFT OUTER JOIN EARBUDS ON PRODUCT_ID=ID WHERE USER_NAME='${username}'`;
        const result = await connection.execute(query);
        const rows = result.rows;
        console.log('rows ', rows);
        res.json(rows);
    }
    catch (error) {
        console.error("Error executing SQL query:", error);
        res.status(500).json({ error: "Internal Server Error" });
    } finally {
        if (connection) {
            try {
                await connection.close();
            } catch (error) {
                console.error("Error closing connection:", error);
            }
        }
    }
 
})

app.post('/Home/addProducts', async(req,res)=>{
    const productID = req.body.productID;
    const quantity = req.body.quantity;
    const username = req.body.username;
    console.log('username spe is ' + username)
    let connection;
    try{
        connection = await  pool.getConnection();
        const existProductQuery = `SELECT JSON_OBJECT (*)  FROM ORDERS WHERE USER_NAME='${username}' AND PRODUCT_ID=${productID}`
        const exitedProducts = await connection.execute(existProductQuery);
        let rows = exitedProducts.rows;
        if(rows.length != 0)
        {
            rows = JSON.parse(rows);
            let currentQuantity = rows.QUANTITY;
            currentQuantity += quantity;
            const updateQuery = `UPDATE ORDERS SET QUANTITY = ${currentQuantity} WHERE PRODUCT_ID=${productID} AND USER_NAME='${username}'`
            console.log('update query is ', updateQuery)
            const res = await connection.execute(updateQuery)
            await connection.commit();
        }
        else
        {
            const query = `INSERT INTO ORDERS(USER_NAME,PRODUCT_ID,QUANTITY) VALUES('${username}',${productID},${quantity})`;
            console.log('query is ' + query)
            const result = await connection.execute(query);
            await connection.commit();
        }
    }
    catch (error) {
        console.error("Error executing SQL query:", error);
        res.status(500).json({ error: "Internal Server Error" });
    } finally {
        if (connection) {
            try {
                await connection.close();
            } catch (error) {
                console.error("Error closing connection:", error);
            }
        }
    }
})
app.post('/create-payment', async (req,res)=>{
    try{
        const intent = await stripe.paymentIntents.create({
            currency:'usd',
            amount: 1999,
            automatic_payment_methods:{
                enabled:true,
            }
        })
        res.send({clientSecret:intent.client_secret})
    }
    catch(err)
    {
        console.log('error payemnt')
    }
    
})

app.post("/OrderProducts", async (req,res)=>{
    console.log("ordering products in backend")
    const body = req.body
    const username = body.username
    const orders = body.orders
    const quantities = body.quantities
    console.log("orders ", orders)
    console.log("quantities ",quantities)
    let connection;
    try{
        connection = await pool.getConnection();
    
        for (const [index, order] of orders.entries()) {
            const productID = order.PRODUCT_ID;
            const quant = quantities[index]
            const deQuery =`DELETE FROM ORDERS WHERE USER_NAME='${username}' AND PRODUCT_ID=${productID}`
            console.log("deQuery ", deQuery)
            await connection.execute(deQuery)
            await connection.commit()

            const updateQuery = `INSERT INTO PAST_ORDERS(USER_NAME,PRODUCT_ID,QUANTITY,BDATE) VALUES('${username}',${productID},${quant},SYSTIMESTAMP)`
            console.log("update query ",updateQuery)
            await connection.execute(updateQuery)
            await connection.commit()
        }
        res.json('success submitting')
    }   
    catch(err)
    {
        console.log(err)
    }
})

app.post('/PastOrders', async (req,res)=>{
    try{
        const username = req.body.username
        connection = await pool.getConnection()
        const query = `SELECT JSON_OBJECT (*) from PAST_ORDERS LEFT OUTER JOIN EARBUDS ON PRODUCT_ID=ID WHERE USER_NAME='${username}'`
        console.log("query for getting past orders is ", query)
        const result = await connection.execute(query)
        await connection.commit()
        const rows = result.rows;
        console.log('rows ', rows);
        res.json(rows);
    }
    catch(error)
    {
        console.log("error gettings past products")
    }
})
app.post('/RemoveOrders',async (req,res)=>{
    console.log("remove orders be")
    try{
        const username = req.body.username;
        const productID = req.body.id
        console.log('username remove orders', username)
        console.log('productID remove orders', productID)

        connection = await pool.getConnection()
        const query = `DELETE FROM ORDERS WHERE USER_NAME='${username}' AND PRODUCT_ID=${productID}`
        console.log("query for removing orders ", query)
        const result = await connection.execute(query)
        await connection.commit();

        console.log('success removing order')
        res.send('success')
    }   
    catch(error)
    {
        console.log("error removin orders")
    }
})

app.listen(3001, ()=>{
    console.log('server is running')
;})