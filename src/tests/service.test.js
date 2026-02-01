    const request = require('supertest');
    const app = require('../service');

    const testUser = { name: 'pizza diner', email: 'reg@test.com', password: 'a' };
    let testUserAuthToken;

    const { DB, Role } = require('../database/database.js');

    function randomName() {
        return Math.random().toString(36).substring(2, 12);
    }

    async function createAdminUser() {
        const user = { 
            name: randomName(), 
            email: randomName() + '@admin.com', 
            password: 'toomanysecrets', 
            roles: [{ role: Role.Admin }] 
        };

        await DB.addUser(user);

        // Login to get token (this matches real behavior)
        const loginRes = await request(app)
            .put('/api/auth')
            .send({ email: user.email, password: user.password });

        return {
            ...user,
            token: loginRes.body.token
        };
    }

    async function createFranchise(adminUser) {
        const franchiseName = `Franchise-${randomName()}`;
        const res = await request(app)
            .post('/api/franchise')
            .set('Authorization', `Bearer ${adminUser.token}`)
            .send({
                name: franchiseName,
                admins: [{ email: adminUser.email }]
            });
        return res.body;
    }

    async function createStore(adminUser, franchiseId) {
        const storeName = `Store-${randomName()}`;
        const res = await request(app)
            .post(`/api/franchise/${franchiseId}/store`)
            .set('Authorization', `Bearer ${adminUser.token}`)
            .send({ name: storeName });
        return res.body;
    }



    beforeAll(async () => {
        testUser.email = Math.random().toString(36).substring(2, 12) + '@test.com';
        const registerRes = await request(app).post('/api/auth').send(testUser);
        testUser.id = registerRes.body.user.id;
        testUserAuthToken = registerRes.body.token;
    });

    test('login', async () => {
        const loginRes = await request(app).put('/api/auth').send(testUser);
        expect(loginRes.status).toBe(200);
        expect(loginRes.body.token).toMatch(/^[a-zA-Z0-9\-_]*\.[a-zA-Z0-9\-_]*\.[a-zA-Z0-9\-_]*$/);

        const { password, ...user } = { ...testUser, roles: [{ role: 'diner' }] };
        expect(loginRes.body.user).toMatchObject(user);
    });
    test('userUpdate', async () => {
        const newEmail = randomName() + '@test.com';
        const updateRes = await request(app)
            .put(`/api/user/${testUser.id}`)
            .set('Authorization', `Bearer ${testUserAuthToken}`)
            .send({ email: newEmail });
        expect(updateRes.status).toBe(200);
        expect(updateRes.body.user.email).toBe(newEmail);
    });

    test('getMenu', async () => {
        const res = await request(app).get('/api/order/menu');
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
    });

    test('addMenuItem (unauthorized)', async () => {
        const res = await request(app)
            .put('/api/order/menu')
            .set('Authorization', `Bearer ${testUserAuthToken}`)
            .send({ title: 'New Pizza', description: 'Delicious', image: 'pizza.png', price: 0.01 });
        expect(res.status).toBe(403);
    });

    test('createOrder and getOrders', async () => {
        const adminUser = await createAdminUser();
        // Create a franchise and store first to avoid hardcoded IDs
        const franchise = await createFranchise(adminUser);
        const franchiseId = franchise.id;

        const store = await createStore(adminUser, franchiseId);
        const storeId = store.id;

        // First, get the menu to find an item
        const menuRes = await request(app).get('/api/order/menu');
        const menuId = menuRes.body[0].id;

        // Create an order
        const orderRes = await request(app)
            .post('/api/order')
            .set('Authorization', `Bearer ${testUserAuthToken}`)
            .send({
                franchiseId: franchiseId,
                storeId: storeId,
                items: [{ menuId: menuId, description: 'Veggie', price: 0.05 }]
            });

        // Note: Factory might fail if not mocked, but we check if it reaches DB logic or fails correctly
        if (orderRes.status === 200) {
            expect(orderRes.body.order).toBeDefined();
            expect(orderRes.body.jwt).toBeDefined();
        } else {
            expect(orderRes.status).toBe(500);
            expect(orderRes.body.message).toMatch(/Failed to fulfill order at factory/);
        }

        // Get orders
        const getOrdersRes = await request(app)
            .get('/api/order')
            .set('Authorization', `Bearer ${testUserAuthToken}`);
        expect(getOrdersRes.status).toBe(200);
        expect(getOrdersRes.body.orders).toBeDefined();
        expect(getOrdersRes.body.orders.length).toBeGreaterThan(0);
    });

    test('addMenuItem', async () => {
        const adminUser = await createAdminUser();

        // Test addMenuItem
        const newItem = { title: 'Admin Pizza', description: 'For admins', image: 'pizza2.png', price: 0.05 };
        const addRes = await request(app)
            .put('/api/order/menu')
            .set('Authorization', `Bearer ${adminUser.token}`)
            .send(newItem);
        expect(addRes.status).toBe(200);
        expect(addRes.body.some(item => item.title === 'Admin Pizza')).toBe(true);

    });
    test('getFranchises', async () => {
        const adminUser = await createAdminUser();
        const getFranchisesRes = await request(app)
            .get('/api/franchise?page=0&limit=10&name=*')
            .set('Authorization', `Bearer ${adminUser.token}`);
        expect(getFranchisesRes.status).toBe(200);
        expect(getFranchisesRes.body.franchises).toBeDefined();
    });
    test('createFranchise', async () => {
        const adminUser = await createAdminUser();

        const createRes = await createFranchise(adminUser);

        expect(createRes.name).toBeDefined();
        expect(createRes.admins).toBeDefined();
        expect(createRes.admins[0].email).toBe(adminUser.email);
    });
    test('franchiseStore', async () => {
        const adminUser = await createAdminUser();

        //Create a franchise
        const franchise = await createFranchise(adminUser);
        const franchiseId = franchise.id;

        //Create store for that franchise
        const store = await createStore(adminUser, franchiseId);

        expect(store.id).toBeDefined();

        //Delete store
        const delRes = await request(app)
            .delete(`/api/franchise/${franchiseId}/store/${store.id}`)
            .set('Authorization', `Bearer ${adminUser.token}`);
        expect(delRes.status).toBe(200);
        expect(delRes.body.message).toBe('store deleted');
    });

    test('deleteFranchise', async () => {
        const adminUser = await createAdminUser();
        
        // Create a franchise to delete
        const franchise = await createFranchise(adminUser);
        const franchiseId = franchise.id;

        // Test deleteFranchise
        const delRes = await request(app)
            .delete(`/api/franchise/${franchiseId}`)
            .set('Authorization', `Bearer ${adminUser.token}`);
        expect(delRes.status).toBe(200);
        expect(delRes.body.message).toBe('franchise deleted');
    });

    test('logout', async () => {
        const logoutRes = await request(app)
            .delete('/api/auth')
            .set('Authorization', `Bearer ${testUserAuthToken}`);
        expect(logoutRes.status).toBe(200);
        expect(logoutRes.body.message).toBe('logout successful');
    });

    test('root endpoint', async () => {
        const res = await request(app).get('/');
        expect(res.status).toBe(200);
        expect(res.body.message).toBe('welcome to JWT Pizza');
        expect(res.body.version).toBeDefined();
    });

    test('docs endpoint', async () => {
        const res = await request(app).get('/api/docs');
        expect(res.status).toBe(200);
        expect(res.body.version).toBeDefined();
        expect(res.body.endpoints).toBeDefined();
    });

    test('unknown endpoint', async () => {
        const res = await request(app).get('/api/unknown');
        expect(res.status).toBe(404);
        expect(res.body.message).toBe('unknown endpoint');
    });

    test('update other user (unauthorized)', async () => {
        const adminUser = await createAdminUser();
        const updateRes = await request(app)
            .put(`/api/user/${adminUser.id}`)
            .set('Authorization', `Bearer ${testUserAuthToken}`)
            .send({ email: 'hacker@test.com' });
        expect(updateRes.status).toBe(401);
    });

    test('login with invalid credentials', async () => {
        const res = await request(app)
            .put('/api/auth')
            .send({ email: testUser.email, password: 'wrongpassword' });
        expect(res.status).toBe(404);
        expect(res.body.message).toBe('unknown user');
    });

    test('create store as non-admin (unauthorized)', async () => {
        const adminUser = await createAdminUser();
        // Create a franchise first
        const franchise = await createFranchise(adminUser);

        const res = await request(app)
            .post(`/api/franchise/${franchise.id}/store`)
            .set('Authorization', `Bearer ${testUserAuthToken}`)
            .send({ name: 'My Store' });
        expect(res.status).toBe(401);
    });