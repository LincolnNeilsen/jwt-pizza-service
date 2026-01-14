module.exports =  {
    // Your JWT secret can be any random string you would like. It just needs to be secret.
    jwtSecret: 'pizzaStore',
    db: {
        connection: {
            host: '127.0.0.1',
            user: 'root',
            password: 'BancOfCalifornia0514!',
            database: 'pizza',
            connectTimeout: 60000,
        },
        listPerPage: 10,
    },
    factory: {
        url: 'https://pizza-factory.cs329.click',
        apiKey: '0f6b9033a28d49f897be1313a52322cd',
    },
};