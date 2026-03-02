const { Sequelize, Model, DataTypes } = require('sequelize');
const path = require('path');

// Database configuration
const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: path.join(__dirname, 'database.sqlite'),
  logging: process.env.NODE_ENV === 'development' ? console.log : false
});

// Models
class User extends Model {}
User.init({
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  email: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
    validate: {
      isEmail: true
    }
  },
  password: {
    type: DataTypes.STRING,
    allowNull: false
  },
  firstName: {
    type: DataTypes.STRING,
    allowNull: false
  },
  lastName: {
    type: DataTypes.STRING,
    allowNull: false
  },
  role: {
    type: DataTypes.ENUM('owner', 'admin', 'client', 'worker'),
    defaultValue: 'client'
  },
  avatar: {
    type: DataTypes.STRING,
    defaultValue: null
  }
}, { sequelize, modelName: 'User' });

class Project extends Model {}
Project.init({
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: false
  },
  status: {
    type: DataTypes.ENUM('planning', 'active', 'completed', 'cancelled'),
    defaultValue: 'planning'
  },
  budget: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false
  },
  deadline: {
    type: DataTypes.DATEONLY,
    allowNull: true
  },
  clientId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: User,
      key: 'id'
    }
  },
  ownerId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: User,
      key: 'id'
    }
  }
}, { sequelize, modelName: 'Project' });

class Task extends Model {}
Task.init({
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  title: {
    type: DataTypes.STRING,
    allowNull: false
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  status: {
    type: DataTypes.ENUM('todo', 'in_progress', 'completed', 'blocked'),
    defaultValue: 'todo'
  },
  priority: {
    type: DataTypes.ENUM('low', 'medium', 'high', 'urgent'),
    defaultValue: 'medium'
  },
  estimatedHours: {
    type: DataTypes.DECIMAL(5, 2),
    allowNull: true
  },
  actualHours: {
    type: DataTypes.DECIMAL(5, 2),
    allowNull: true
  },
  projectId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: Project,
      key: 'id'
    }
  },
  assigneeId: {
    type: DataTypes.UUID,
    allowNull: true,
    references: {
      model: User,
      key: 'id'
    }
  }
}, { sequelize, modelName: 'Task' });

// Associations
User.hasMany(Project, { foreignKey: 'clientId', as: 'clientProjects' });
User.hasMany(Project, { foreignKey: 'ownerId', as: 'ownedProjects' });
User.hasMany(Task, { foreignKey: 'assigneeId', as: 'assignedTasks' });

Project.belongsTo(User, { foreignKey: 'clientId', as: 'client' });
Project.belongsTo(User, { foreignKey: 'ownerId', as: 'owner' });
Project.hasMany(Task, { foreignKey: 'projectId', as: 'tasks' });

Task.belongsTo(Project, { foreignKey: 'projectId', as: 'project' });
Task.belongsTo(User, { foreignKey: 'assigneeId', as: 'assignee' });

// Export models
module.exports = {
  sequelize,
  User,
  Project,
  Task
};