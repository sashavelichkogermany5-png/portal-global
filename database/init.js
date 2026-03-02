const { sequelize } = require('./models');

// Run migrations
async function runMigrations() {
  try {
    console.log('Running database migrations...');
    await sequelize.authenticate();
    await sequelize.sync({ alter: true });
    console.log('Database synchronized successfully');
  } catch (error) {
    console.error('Error running migrations:', error);
    process.exit(1);
  }
}

// Seed database with sample data
async function seedDatabase() {
  try {
    console.log('Seeding database with sample data...');
    
    // Create sample users
    const users = await Promise.all([
      User.create({
        email: 'admin@portal.com',
        password: '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', // password
        firstName: 'Admin',
        lastName: 'User',
        role: 'admin'
      }),
      User.create({
        email: 'client@portal.com',
        password: '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', // password
        firstName: 'Client',
        lastName: 'User',
        role: 'client'
      }),
      User.create({
        email: 'worker@portal.com',
        password: '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', // password
        firstName: 'Worker',
        lastName: 'User',
        role: 'worker'
      })
    ]);
    
    // Create sample projects
    const projects = await Promise.all([
      Project.create({
        name: 'Portal Global Platform',
        description: 'Unified portal management platform for modern projects',
        status: 'active',
        budget: 150000.00,
        deadline: '2024-12-31',
        clientId: users[1].id,
        ownerId: users[0].id
      }),
      Project.create({
        name: 'AI Project Generator',
        description: 'AI-powered project planning and estimation tool',
        status: 'planning',
        budget: 75000.00,
        deadline: '2024-11-30',
        clientId: users[1].id,
        ownerId: users[0].id
      })
    ]);
    
    // Create sample tasks
    await Promise.all([
      Task.create({
        title: 'Setup database schema',
        description: 'Design and implement database structure for portal',
        status: 'completed',
        priority: 'high',
        estimatedHours: 8.0,
        actualHours: 6.5,
        projectId: projects[0].id,
        assigneeId: users[2].id
      }),
      Task.create({
        title: 'Implement authentication system',
        description: 'Create JWT-based authentication with role management',
        status: 'in_progress',
        priority: 'high',
        estimatedHours: 16.0,
        actualHours: 12.0,
        projectId: projects[0].id,
        assigneeId: users[2].id
      }),
      Task.create({
        title: 'Design frontend UI',
        description: 'Create responsive UI with Tailwind CSS',
        status: 'todo',
        priority: 'medium',
        estimatedHours: 24.0,
        projectId: projects[0].id,
        assigneeId: users[2].id
      })
    ]);
    
    console.log('Database seeded successfully with sample data');
    console.log('Created:');
    console.log(`- ${users.length} users`);
    console.log(`- ${projects.length} projects`);
    console.log(`- ${await Task.count()} tasks`);
  } catch (error) {
    console.error('Error seeding database:', error);
  }
}

// Initialize database
async function initDatabase() {
  try {
    await sequelize.authenticate();
    console.log('Database connection established successfully');
    
    // Run migrations and seed data
    await runMigrations();
    await seedDatabase();
    
    console.log('Database initialization completed');
  } catch (error) {
    console.error('Database initialization failed:', error);
    process.exit(1);
  }
}

// Export functions
module.exports = {
  initDatabase,
  runMigrations,
  seedDatabase,
  sequelize
};