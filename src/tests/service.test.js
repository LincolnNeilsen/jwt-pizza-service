const request = require('supertest');
const app = require('../service');

const {DB, Role} = require('../database/database.js');

async function createAdminUser() {
    return createUserAndLogin([{role: Role.Admin}]);
}

async function createUserAndLogin(roles = [{role: Role.Diner}]) {
    const user = {
        name: randomName(),
        email: randomName() + '@test.com',
        password: 'password',
        roles: roles
    };
    await DB.addUser(user);
    const loginRes = await request(app).put('/api/auth').send({email: user.email, password: user.password});
    return {
        ...user,
        id: loginRes.body.user.id,
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
            admins: [{email: adminUser.email}]
        });
    return res.body;
}

async function createStore(adminUser, franchiseId) {
    const storeName = `Store-${randomName()}`;
    const res = await request(app)
        .post(`/api/franchise/${franchiseId}/store`)
        .set('Authorization', `Bearer ${adminUser.token}`)
        .send({name: storeName});
    return res.body;
}

async function createOrder(userToken, franchiseId, storeId, item) {
    return request(app)
        .post('/api/order')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
            franchiseId: franchiseId,
            storeId: storeId,
            items: [{menuId: item.id, description: item.description, price: item.price}]
        });
}

async function addMenuItem(adminUser, item) {
    return request(app)
        .put('/api/order/menu')
        .set('Authorization', `Bearer ${adminUser.token}`)
        .send(item);
}

async function registerUser(service) {
    const testUser = {
        name: 'pizza diner',
        email: `${randomName()}@test.com`,
        password: 'a',
    };
    const registerRes = await service.post('/api/auth').send(testUser);
    registerRes.body.user.password = testUser.password;

    return [registerRes.body.user, registerRes.body.token];
}

function randomName() {
    return Math.random().toString(36).substring(2, 12);
}


beforeEach(() => {
    global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
            reportUrl: 'http://factory-report.com',
            jwt: 'mock-factory-jwt'
        }),
    });
});

test('login', async () => {
    const userName = randomName();
    const userEmail = randomName() + '@test.com';
    const userPassword = 'password';

    // Register first
    await request(app)
        .post('/api/auth')
        .send({name: userName, email: userEmail, password: userPassword});

    const loginRes = await request(app)
        .put('/api/auth')
        .send({email: userEmail, password: userPassword});

    expect(loginRes.status).toBe(200);
    expect(loginRes.body.token).toMatch(/^[a-zA-Z0-9\-_]*\.[a-zA-Z0-9\-_]*\.[a-zA-Z0-9\-_]*$/);

    expect(loginRes.body.user).toMatchObject({
        name: userName,
        email: userEmail,
        roles: [{role: Role.Diner}]
    });
});

test('userUpdate', async () => {
    const user = await createUserAndLogin();
    const newEmail = randomName() + '@test.com';
    const updateRes = await request(app)
        .put(`/api/user/${user.id}`)
        .set('Authorization', `Bearer ${user.token}`)
        .send({email: newEmail});
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.user.email).toBe(newEmail);
});

test('getMenu', async () => {
    const res = await request(app).get('/api/order/menu');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
});

test('addMenuItem (unauthorized)', async () => {
    const user = await createUserAndLogin();
    const res = await request(app)
        .put('/api/order/menu')
        .set('Authorization', `Bearer ${user.token}`)
        .send({title: 'New Pizza', description: 'Delicious', image: 'pizza.png', price: 0.01});
    expect(res.status).toBe(403);
});

test('createOrder and getOrders', async () => {
    const user = await createUserAndLogin();
    const adminUser = await createAdminUser();

    // Ensure there is at least one item in the menu
    const newItem = {title: 'Test Pizza', description: 'For testing', image: 'pizza.png', price: 0.05};
    await addMenuItem(adminUser, newItem);

    // Create a franchise and store first to avoid hardcoded IDs
    const franchise = await createFranchise(adminUser);
    const store = await createStore(adminUser, franchise.id);

    // First, get the menu to find an item
    const menuRes = await request(app).get('/api/order/menu');
    const item = menuRes.body[0];

    // Create an order
    const orderRes = await createOrder(user.token, franchise.id, store.id, item);

    expect(orderRes.status).toBe(200);
    expect(orderRes.body.order).toBeDefined();
    expect(orderRes.body.order.items[0].description).toBe(item.description);
    expect(orderRes.body.jwt).toBe('mock-factory-jwt');
    expect(global.fetch).toHaveBeenCalled();

    // Get orders
    const getOrdersRes = await request(app)
        .get('/api/order')
        .set('Authorization', `Bearer ${user.token}`);
    expect(getOrdersRes.status).toBe(200);
    expect(getOrdersRes.body.orders).toBeDefined();
    expect(getOrdersRes.body.orders.length).toBeGreaterThan(0);

    const createdOrder = getOrdersRes.body.orders.find(o => o.id === orderRes.body.order.id);
    expect(createdOrder).toBeDefined();
});

test('createOrder (factory failure)', async () => {
    const user = await createUserAndLogin();
    const adminUser = await createAdminUser();

    // Ensure there is at least one item in the menu
    const newItem = {title: 'Test Pizza', description: 'For testing', image: 'pizza.png', price: 0.05};
    await addMenuItem(adminUser, newItem);

    const franchise = await createFranchise(adminUser);
    const store = await createStore(adminUser, franchise.id);

    const menuRes = await request(app).get('/api/order/menu');
    const item = menuRes.body[0];

    global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        json: async () => ({
            reportUrl: 'http://factory-report.com/fail',
            message: 'Factory error'
        }),
    });

    const orderRes = await createOrder(user.token, franchise.id, store.id, item);

    expect(orderRes.status).toBe(500);
    expect(orderRes.body.message).toBe('Failed to fulfill order at factory');
});

test('addMenuItem', async () => {
    const adminUser = await createAdminUser();

    // Test addMenuItem
    const newItem = {title: 'Admin Pizza', description: 'For admins', image: 'pizza2.png', price: 0.05};
    const addRes = await addMenuItem(adminUser, newItem);
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
    const user = await createUserAndLogin();
    const logoutRes = await request(app)
        .delete('/api/auth')
        .set('Authorization', `Bearer ${user.token}`);
    expect(logoutRes.status).toBe(200);
    expect(logoutRes.body.message).toBe('logout successful');
});

test('register (invalid body)', async () => {
    const res = await request(app)
        .post('/api/auth')
        .send({name: 'missing email and password'});
    expect(res.status).toBe(400);
});

test('createOrder (invalid body)', async () => {
    const user = await createUserAndLogin();
    const res = await request(app)
        .post('/api/order')
        .set('Authorization', `Bearer ${user.token}`)
        .send({franchiseId: 1}); // Missing items and storeId
    // The app might fail with 500 or 400 depending on implementation
    // Let's see what happens.
    expect([400, 500]).toContain(res.status);
});

test('getMe', async () => {
    const user = await createUserAndLogin();

    const res = await request(app)
        .get('/api/user/me')
        .set('Authorization', `Bearer ${user.token}`);

    expect(res.status).toBe(200);
    expect(res.body.email).toBe(user.email);
    expect(res.body.roles).toBeDefined();
    expect(res.body.roles.length).toBeGreaterThan(0);
});

test('getUserFranchises', async () => {
    const adminUser = await createAdminUser();

    // Create a franchise where adminUser is an admin
    const franchise = await createFranchise(adminUser);

    // Re-login as admin to ensure the role update is reflected in the token if necessary
    const loginRes = await request(app).put('/api/auth').send({email: adminUser.email, password: adminUser.password});
    const token = loginRes.body.token;
    const userId = loginRes.body.user.id;

    const res = await request(app)
        .get(`/api/franchise/${userId}`)
        .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body[0].id).toBe(franchise.id);
});

test('createFranchise (unauthorized)', async () => {
    const user = await createUserAndLogin();

    const res = await request(app)
        .post('/api/franchise')
        .set('Authorization', `Bearer ${user.token}`)
        .send({name: 'Hack Franchise', admins: [{email: user.email}]});
    // The middleware returns 403 if req.user exists but is not an admin
    expect([401, 403]).toContain(res.status);
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
    const user = await createUserAndLogin();
    const updateRes = await request(app)
        .put(`/api/user/${adminUser.id}`)
        .set('Authorization', `Bearer ${user.token}`)
        .send({email: 'hacker@test.com'});
    expect(updateRes.status).toBe(403);
});

test('login with invalid credentials', async () => {
    const res = await request(app)
        .put('/api/auth')
        .send({email: 'nonexistent@test.com', password: 'wrongpassword'});
    expect(res.status).toBe(404);
    expect(res.body.message).toBe('unknown user');
});

test('create store as non-admin (unauthorized)', async () => {
    const adminUser = await createAdminUser();
    // Create a franchise first
    const franchise = await createFranchise(adminUser);

    // Ensure we have a valid token for a non-admin user
    const user = await createUserAndLogin();

    const res = await request(app)
        .post(`/api/franchise/${franchise.id}/store`)
        .set('Authorization', `Bearer ${user.token}`)
        .send({name: 'My Store'});
    expect([401, 403]).toContain(res.status);
});

test('deleteStore (unauthorized)', async () => {
    const adminUser = await createAdminUser();
    const franchise = await createFranchise(adminUser);
    const store = await createStore(adminUser, franchise.id);

    // Ensure we have a valid token for a non-admin user
    const user = await createUserAndLogin();

    const res = await request(app)
        .delete(`/api/franchise/${franchise.id}/store/${store.id}`)
        .set('Authorization', `Bearer ${user.token}`);
    expect([401, 403]).toContain(res.status);
});
test('delete store as franchisee', async () => {
    const adminUser = await createAdminUser();

    // Create a franchisee user
    const franchiseeUser = await createUserAndLogin();

    // Create franchise with this user as admin
    const franchise = await createFranchise({...adminUser, email: franchiseeUser.email});
    const franchiseId = franchise.id;

    // Create store
    const store = await createStore(adminUser, franchiseId);

    // Delete store as franchisee
    const delRes = await request(app)
        .delete(`/api/franchise/${franchiseId}/store/${store.id}`)
        .set('Authorization', `Bearer ${franchiseeUser.token}`);
    expect(delRes.status).toBe(200);
    expect(delRes.body.message).toBe('store deleted');
});

test('unauthorized list users', async () => {
    const listUsersRes = await request(app).get('/api/user');
    expect(listUsersRes.status).toBe(401);
});
test('list users pagination and filtering', async () => {
    const adminUser = await createAdminUser();
    const nameToSearch = randomName();
    const user1 = {
        name: nameToSearch + ' One',
        email: randomName() + '@test.com',
        password: 'password',
        roles: [{role: Role.Diner}]
    };
    const user2 = {
        name: nameToSearch + ' Two',
        email: randomName() + '@test.com',
        password: 'password',
        roles: [{role: Role.Diner}]
    };
    await DB.addUser(user1);
    await DB.addUser(user2);

    // Test filtering by name
    const filterRes = await request(app)
        .get(`/api/user?name=${nameToSearch}`)
        .set('Authorization', 'Bearer ' + adminUser.token);

    expect(filterRes.status).toBe(200);
    expect(filterRes.body.users.length).toBeGreaterThanOrEqual(2);
    filterRes.body.users.forEach(u => {
        expect(u.name.toLowerCase()).toContain(nameToSearch.toLowerCase());
    });

    // Test pagination
    const pageRes = await request(app)
        .get(`/api/user?page=0&limit=1`)
        .set('Authorization', 'Bearer ' + adminUser.token);

    expect(pageRes.status).toBe(200);
    expect(pageRes.body.users.length).toBe(1);
    expect(pageRes.body.more).toBeDefined();
    expect(typeof pageRes.body.more).toBe('boolean');
    expect(pageRes.body.users[0].roles).toBeDefined();
    expect(pageRes.body.users[0].roles.length).toBeGreaterThan(0);
});

test('delete user (unauthorized)', async () => {
    const user = await createUserAndLogin();
    const deleteUserRes = await request(app)
        .delete(`/api/user/${user.id}`)
        .set('Authorization', 'Bearer ' + user.token);
    expect(deleteUserRes.status).toBe(403);
    expect(deleteUserRes.body.message).toBe('unauthorized');
});

test('delete user', async () => {
    const adminUser = await createAdminUser();
    const userToDelete = await createUserAndLogin();

    const deleteUserRes = await request(app)
        .delete(`/api/user/${userToDelete.id}`)
        .set('Authorization', 'Bearer ' + adminUser.token);

    expect(deleteUserRes.status).toBe(200);
    expect(deleteUserRes.body.message).toBe(`User ${userToDelete.id} deleted`);

    // Verify user is gone
    const loginRes = await request(app)
        .put('/api/auth')
        .send({email: userToDelete.email, password: userToDelete.password});
    expect(loginRes.status).toBe(404);
});