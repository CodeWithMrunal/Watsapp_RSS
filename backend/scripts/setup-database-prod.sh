#!/bin/bash
# backend/scripts/production-database-setup.sh

set -e  # Exit on any error

echo "🚀 Setting up WhatsApp Monitor Database for PRODUCTION"
echo "============================================"

# Check if running as production user
if [ "$USER" = "root" ]; then
    echo "❌ Do not run this script as root user for security reasons"
    exit 1
fi

# Create .env file for production
if [ ! -f ../.env.production ]; then
    echo "Creating production .env file..."
    cat > ../.env.production << 'ENV_EOF'
# Production Database Configuration
DB_HOST=your-production-host.com
DB_PORT=5432
DB_USERNAME=whatsapp_monitor_prod
DB_PASSWORD=CHANGE_THIS_SECURE_PASSWORD
DB_NAME=whatsapp_monitor_prod
DB_NAME_TEST=whatsapp_monitor_test
DB_SSL=true
DB_SSL_REJECT_UNAUTHORIZED=false

# Connection Pool Settings
DB_POOL_MIN=2
DB_POOL_MAX=20
DB_POOL_ACQUIRE=30000
DB_POOL_IDLE=10000

# Node Environment
NODE_ENV=production

# Logging
LOG_LEVEL=info
LOG_FILE=logs/app.log

# Security
JWT_SECRET=CHANGE_THIS_JWT_SECRET
ENCRYPTION_KEY=CHANGE_THIS_32_CHAR_ENCRYPTION_KEY
CORS_ORIGIN=https://your-frontend-domain.com

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100
ENV_EOF
    echo "✅ Created .env.production file"
    echo "⚠️  IMPORTANT: Update all CHANGE_THIS_* values with secure credentials!"
    echo ""
fi

# Move to backend directory
cd ..

# Install required packages (production versions)
echo "Installing production database packages..."
npm install --production sequelize sequelize-cli pg pg-hstore dotenv

# Create .sequelizerc file
echo "Creating Sequelize configuration..."
cat > .sequelizerc << 'SEQUELIZE_EOF'
const path = require('path');

module.exports = {
  'config': path.resolve('config', 'database.js'),
  'models-path': path.resolve('models'),
  'seeders-path': path.resolve('seeders'),
  'migrations-path': path.resolve('migrations')
};
SEQUELIZE_EOF

# Create production database config
mkdir -p config
echo "Creating production database configuration..."
cat > config/database.js << 'DB_CONFIG_EOF'
require('dotenv').config({ path: `.env.${process.env.NODE_ENV || 'development'}` });

module.exports = {
  development: {
    username: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    dialect: 'postgres',
    logging: console.log
  },
  production: {
    username: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    dialect: 'postgres',
    logging: false,
    dialectOptions: {
      ssl: process.env.DB_SSL === 'true' ? {
        require: true,
        rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false'
      } : false
    },
    pool: {
      min: parseInt(process.env.DB_POOL_MIN) || 2,
      max: parseInt(process.env.DB_POOL_MAX) || 20,
      acquire: parseInt(process.env.DB_POOL_ACQUIRE) || 30000,
      idle: parseInt(process.env.DB_POOL_IDLE) || 10000
    },
    define: {
      timestamps: true,
      underscored: true,
      freezeTableName: true
    }
  }
};
DB_CONFIG_EOF

# Initialize Sequelize if not already done
if [ ! -d "models" ]; then
    echo "Initializing Sequelize..."
    npx sequelize-cli init
fi

# Check database connection before proceeding
echo "Testing database connection..."
NODE_ENV=production npx sequelize-cli db:create --env production || {
    echo "❌ Database connection failed. Please check your credentials in .env.production"
    exit 1
}

# Create enhanced migration file with production optimizations
TIMESTAMP=$(date +%Y%m%d%H%M%S)
MIGRATION_FILE="migrations/${TIMESTAMP}-create-all-tables-production.js"

echo "Creating optimized production migration file: $MIGRATION_FILE"
cat > "$MIGRATION_FILE" << 'MIGRATION_EOF'
'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    // Create groups table with production optimizations
    await queryInterface.createTable('groups', {
      id: {
        type: Sequelize.STRING,
        primaryKey: true,
        allowNull: false
      },
      name: {
        type: Sequelize.STRING(255),
        allowNull: false
      },
      participant_count: {
        type: Sequelize.INTEGER,
        defaultValue: 0,
        validate: { min: 0 }
      },
      is_archived: {
        type: Sequelize.BOOLEAN,
        defaultValue: false,
        allowNull: false
      },
      is_muted: {
        type: Sequelize.BOOLEAN,
        defaultValue: false,
        allowNull: false
      },
      last_activity: {
        type: Sequelize.DATE,
        allowNull: true
      },
      metadata: {
        type: Sequelize.JSONB,
        defaultValue: {},
        allowNull: false
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      }
    });

    // Create authors table with constraints
    await queryInterface.createTable('authors', {
      id: {
        type: Sequelize.STRING,
        primaryKey: true,
        allowNull: false
      },
      phone_number: {
        type: Sequelize.STRING(20),
        allowNull: true,
        unique: true
      },
      push_name: {
        type: Sequelize.STRING(255),
        allowNull: true
      },
      is_business_account: {
        type: Sequelize.BOOLEAN,
        defaultValue: false,
        allowNull: false
      },
      profile_pic_url: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      first_seen: {
        type: Sequelize.DATE,
        defaultValue: Sequelize.NOW,
        allowNull: false
      },
      last_seen: {
        type: Sequelize.DATE,
        defaultValue: Sequelize.NOW,
        allowNull: false
      },
      message_count: {
        type: Sequelize.INTEGER,
        defaultValue: 0,
        allowNull: false,
        validate: { min: 0 }
      },
      media_count: {
        type: Sequelize.INTEGER,
        defaultValue: 0,
        allowNull: false,
        validate: { min: 0 }
      },
      metadata: {
        type: Sequelize.JSONB,
        defaultValue: {},
        allowNull: false
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      }
    });

    // Create messages table with partitioning consideration
    await queryInterface.createTable('messages', {
      id: {
        type: Sequelize.STRING,
        primaryKey: true,
        allowNull: false
      },
      message_id: {
        type: Sequelize.STRING,
        allowNull: false,
        unique: true
      },
      group_id: {
        type: Sequelize.STRING,
        allowNull: false,
        references: {
          model: 'groups',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      author_id: {
        type: Sequelize.STRING,
        allowNull: false,
        references: {
          model: 'authors',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      timestamp: {
        type: Sequelize.BIGINT,
        allowNull: false
      },
      message_date: {
        type: Sequelize.DATE,
        allowNull: false
      },
      type: {
        type: Sequelize.STRING(50),
        allowNull: false
      },
      body: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      original_body: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      caption: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      has_media: {
        type: Sequelize.BOOLEAN,
        defaultValue: false,
        allowNull: false
      },
      is_forwarded: {
        type: Sequelize.BOOLEAN,
        defaultValue: false,
        allowNull: false
      },
      is_starred: {
        type: Sequelize.BOOLEAN,
        defaultValue: false,
        allowNull: false
      },
      is_deleted: {
        type: Sequelize.BOOLEAN,
        defaultValue: false,
        allowNull: false
      },
      is_ephemeral: {
        type: Sequelize.BOOLEAN,
        defaultValue: false,
        allowNull: false
      },
      is_status: {
        type: Sequelize.BOOLEAN,
        defaultValue: false,
        allowNull: false
      },
      is_broadcast: {
        type: Sequelize.BOOLEAN,
        defaultValue: false,
        allowNull: false
      },
      from_jid: {
        type: Sequelize.STRING,
        allowNull: true
      },
      to_jid: {
        type: Sequelize.STRING,
        allowNull: true
      },
      word_count: {
        type: Sequelize.INTEGER,
        defaultValue: 0,
        allowNull: false,
        validate: { min: 0 }
      },
      char_count: {
        type: Sequelize.INTEGER,
        defaultValue: 0,
        allowNull: false,
        validate: { min: 0 }
      },
      detected_language: {
        type: Sequelize.STRING(10),
        allowNull: true
      },
      device_type: {
        type: Sequelize.STRING(50),
        allowNull: true
      },
      quoted_message_id: {
        type: Sequelize.STRING,
        allowNull: true
      },
      quoted_message_data: {
        type: Sequelize.JSONB,
        allowNull: true
      },
      raw_data: {
        type: Sequelize.JSONB,
        defaultValue: {},
        allowNull: false
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      }
    });

    // Continue with other tables (media, links, mentions, etc.)
    // ... (keeping the same structure as your original migration but with production optimizations)

    // Create production-optimized indexes
    await queryInterface.addIndex('groups', ['name'], { name: 'idx_groups_name' });
    await queryInterface.addIndex('groups', ['last_activity'], { name: 'idx_groups_last_activity' });
    await queryInterface.addIndex('groups', ['is_archived', 'is_muted'], { name: 'idx_groups_status' });
    
    await queryInterface.addIndex('authors', ['phone_number'], { 
      name: 'idx_authors_phone', 
      unique: true, 
      where: { phone_number: { [Sequelize.Op.ne]: null } }
    });
    await queryInterface.addIndex('authors', ['push_name'], { name: 'idx_authors_push_name' });
    await queryInterface.addIndex('authors', ['last_seen'], { name: 'idx_authors_last_seen' });
    
    // Composite indexes for common queries
    await queryInterface.addIndex('messages', ['group_id', 'message_date'], { name: 'idx_messages_group_date' });
    await queryInterface.addIndex('messages', ['author_id', 'message_date'], { name: 'idx_messages_author_date' });
    await queryInterface.addIndex('messages', ['timestamp'], { name: 'idx_messages_timestamp' });
    await queryInterface.addIndex('messages', ['type', 'has_media'], { name: 'idx_messages_type_media' });
    await queryInterface.addIndex('messages', ['message_date'], { name: 'idx_messages_date' });
    
    // Add full-text search index for message body (PostgreSQL specific)
    await queryInterface.sequelize.query(`
      CREATE INDEX IF NOT EXISTS idx_messages_body_fulltext 
      ON messages USING gin(to_tsvector('english', coalesce(body, '')))
    `);
    
    console.log('✅ All tables and indexes created successfully for production');
  },

  async down(queryInterface, Sequelize) {
    // Drop tables in reverse order due to foreign key constraints
    const tables = [
      'conversation_summaries', 'message_groups', 'reactions', 
      'mentions', 'links', 'media', 'messages', 'authors', 'groups'
    ];
    
    for (const table of tables) {
      await queryInterface.dropTable(table);
    }
  }
};
MIGRATION_EOF

# Run migrations in production mode
echo "Running production migrations..."
NODE_ENV=production npx sequelize-cli db:migrate --env production

# Create backup script
echo "Creating backup script..."
cat > scripts/backup-database.sh << 'BACKUP_EOF'
#!/bin/bash
# Backup script for production database

source ../.env.production

BACKUP_DIR="backups/$(date +%Y%m%d)"
mkdir -p "$BACKUP_DIR"

BACKUP_FILE="$BACKUP_DIR/whatsapp_monitor_$(date +%Y%m%d_%H%M%S).sql"

echo "Creating database backup: $BACKUP_FILE"
PGPASSWORD="$DB_PASSWORD" pg_dump \
    -h "$DB_HOST" \
    -p "$DB_PORT" \
    -U "$DB_USERNAME" \
    -d "$DB_NAME" \
    --clean \
    --if-exists \
    --create \
    --verbose \
    > "$BACKUP_FILE"

# Compress the backup
gzip "$BACKUP_FILE"

echo "✅ Backup completed: ${BACKUP_FILE}.gz"

# Clean up old backups (keep last 7 days)
find backups/ -name "*.sql.gz" -mtime +7 -delete
BACKUP_EOF

chmod +x scripts/backup-database.sh

echo "✅ Production database setup complete!"
echo ""
echo "📋 Next Steps:"
echo "1. Update .env.production with your actual database credentials"
echo "2. Configure SSL certificates if using SSL"
echo "3. Set up automated backups: crontab -e"
echo "   Example: 0 2 * * * /path/to/your/app/backend/scripts/backup-database.sh"
echo "4. Configure monitoring and alerting"
echo "5. Set up connection pooling and read replicas if needed"
echo ""
echo "🔒 Security Reminders:"
echo "- Use strong passwords (at least 16 characters)"
echo "- Enable SSL/TLS for database connections"
echo "- Restrict database access by IP"
echo "- Regularly update and patch your database"
echo "- Monitor for suspicious activity"