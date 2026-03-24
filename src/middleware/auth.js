// In index.js - requireAuth middleware
// const requireAuth = async (req, res, next) => {
//     const token = req.headers.authorization?.split(' ')[1];

//         if (!token) {
//             return res.status(401).json({ success: false, error: 'Authentication required' });
//         }

//         try {
//             const session = await this.models.user.validateSession(token);
//             if (!session) {
//                 return res.status(401).json({ success: false, error: 'Invalid session' });
//             }
//             req.user = session;
//             next();
//         } catch (error) {
//             res.status(500).json({ success: false, error: 'Authentication failed' });
//         }
// };

const requireWebAuth = async (req, res, next) => {
    console.log('=== requireWebAuth called ===');
    console.log('Session:', req.session);
    console.log('Session token:', req.session?.token);

    const token = req.session?.token;

    if (!token) {
        console.log('No token found in session');
        return res.redirect('/login');
    }

    try {
        const models = req.app.locals.models;
        console.log('Models available:', !!models);

        const session = await models.user.validateSession(token);
        console.log('Session validation result:', !!session);

        if (!session) {
            console.log('Session validation failed');
            return res.redirect('/login');
        }

        const user = await models.user.findById(session.user_id);
        console.log('User found:', !!user);
        console.log('User ID:', user?.id);

        if (!user) {
            console.log('User not found');
            return res.redirect('/login');
        }

        req.user = user;
        console.log('req.user set successfully');

        next();
    } catch (error) {
        console.error('Auth error details:', error);
        res.redirect('/login');
    }
};

const requireApiAuth = async (req, res, next) => {

    // Check for Authorization header first (for API clients)
    const authHeader = req.headers.authorization;
    let token = authHeader?.split(' ')[1];
    
    // If no Authorization header, check session cookie (for web app API calls)
    if (!token && req.session?.token) {
        token = req.session.token;
    }
    

    if (!token) {
        return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    try {
        const models = req.app.locals.models;
        const session = await models.user.validateSession(token);
        if (!session) {
            return res.status(401).json({ success: false, error: 'Invalid session' });
        }
        req.user = session;
        next();
    } catch (error) {
        res.status(500).json({ success: false, error: 'Authentication failed' });
    }
};

module.exports = { requireWebAuth, requireApiAuth }