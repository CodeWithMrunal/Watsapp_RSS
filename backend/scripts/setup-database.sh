#!/bin/bash
# backend/scripts/setup-database.sh

# Create .env file if it doesn't exist
if [ ! -f ../.env ]; then
  echo "Creating .env file..."
  cat > ../.env << 'ENV_EOF'
# Database Configuration
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=mrunal.a
DB_PASSWORD=
DB_NAME=whatsapp_monitor_dev
DB_NAME_TEST=whatsapp_monitor_test

# Node Environment
NODE_ENV=development
ENV_EOF
  echo "✅ Created .env file. Please update with your database credentials."
fi

# Move to backend directory
cd ..

# Install required packages
echo "Installing database packages..."
npm install sequelize sequelize-cli pg pg-hstore dotenv

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

# Initialize Sequelize
echo "Initializing Sequelize..."
npx sequelize-cli init

# Create the database
echo "Creating database..."
npx sequelize-cli db:create

# Create migration file with proper timestamp
TIMESTAMP=$(date +%Y%m%d%H%M%S)
MIGRATION_FILE="migrations/${TIMESTAMP}-create-all-tables.js"

echo "Creating migration file: $MIGRATION_FILE"
cat > "$MIGRATION_FILE" << 'MIGRATION_EOF'
'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    // Create groups table
    await queryInterface.createTable('groups', {
      id: {
        type: Sequelize.STRING,
        primaryKey: true,
        allowNull: false
      },
      name: {
        type: Sequelize.STRING,
        allowNull: false
      },
      participant_count: {
        type: Sequelize.INTEGER,
        defaultValue: 0
      },
      is_archived: {
        type: Sequelize.BOOLEAN,
        defaultValue: false
      },
      is_muted: {
        type: Sequelize.BOOLEAN,
        defaultValue: false
      },
      last_activity: {
        type: Sequelize.DATE,
        allowNull: true
      },
      metadata: {
        type: Sequelize.JSONB,
        defaultValue: {}
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

    // Create authors table
    await queryInterface.createTable('authors', {
      id: {
        type: Sequelize.STRING,
        primaryKey: true,
        allowNull: false
      },
      phone_number: {
        type: Sequelize.STRING,
        allowNull: true
      },
      push_name: {
        type: Sequelize.STRING,
        allowNull: true
      },
      is_business_account: {
        type: Sequelize.BOOLEAN,
        defaultValue: false
      },
      profile_pic_url: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      first_seen: {
        type: Sequelize.DATE,
        defaultValue: Sequelize.NOW
      },
      last_seen: {
        type: Sequelize.DATE,
        defaultValue: Sequelize.NOW
      },
      message_count: {
        type: Sequelize.INTEGER,
        defaultValue: 0
      },
      media_count: {
        type: Sequelize.INTEGER,
        defaultValue: 0
      },
      metadata: {
        type: Sequelize.JSONB,
        defaultValue: {}
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

    // Create messages table
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
        type: Sequelize.STRING,
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
        defaultValue: false
      },
      is_forwarded: {
        type: Sequelize.BOOLEAN,
        defaultValue: false
      },
      is_starred: {
        type: Sequelize.BOOLEAN,
        defaultValue: false
      },
      is_deleted: {
        type: Sequelize.BOOLEAN,
        defaultValue: false
      },
      is_ephemeral: {
        type: Sequelize.BOOLEAN,
        defaultValue: false
      },
      is_status: {
        type: Sequelize.BOOLEAN,
        defaultValue: false
      },
      is_broadcast: {
        type: Sequelize.BOOLEAN,
        defaultValue: false
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
        defaultValue: 0
      },
      char_count: {
        type: Sequelize.INTEGER,
        defaultValue: 0
      },
      detected_language: {
        type: Sequelize.STRING,
        allowNull: true
      },
      device_type: {
        type: Sequelize.STRING,
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
        defaultValue: {}
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

    // Create media table
    await queryInterface.createTable('media', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true
      },
      message_id: {
        type: Sequelize.STRING,
        allowNull: false,
        unique: true,
        references: {
          model: 'messages',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      file_path: {
        type: Sequelize.STRING,
        allowNull: false
      },
      filename: {
        type: Sequelize.STRING,
        allowNull: false
      },
      original_filename: {
        type: Sequelize.STRING,
        allowNull: true
      },
      file_size: {
        type: Sequelize.BIGINT,
        defaultValue: 0
      },
      file_hash: {
        type: Sequelize.STRING,
        allowNull: true
      },
      mimetype: {
        type: Sequelize.STRING,
        allowNull: true
      },
      media_type: {
        type: Sequelize.STRING,
        allowNull: false
      },
      width: {
        type: Sequelize.INTEGER,
        allowNull: true
      },
      height: {
        type: Sequelize.INTEGER,
        allowNull: true
      },
      duration: {
        type: Sequelize.FLOAT,
        allowNull: true
      },
      thumbnail_path: {
        type: Sequelize.STRING,
        allowNull: true
      },
      is_voice_note: {
        type: Sequelize.BOOLEAN,
        defaultValue: false
      },
      saved_at: {
        type: Sequelize.DATE,
        defaultValue: Sequelize.NOW
      },
      metadata: {
        type: Sequelize.JSONB,
        defaultValue: {}
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

    // Create links table
    await queryInterface.createTable('links', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true
      },
      message_id: {
        type: Sequelize.STRING,
        allowNull: false,
        references: {
          model: 'messages',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      url: {
        type: Sequelize.TEXT,
        allowNull: false
      },
      domain: {
        type: Sequelize.STRING,
        allowNull: true
      },
      link_type: {
        type: Sequelize.STRING,
        allowNull: true
      },
      position: {
        type: Sequelize.INTEGER,
        defaultValue: 0
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

    // Create mentions table
    await queryInterface.createTable('mentions', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true
      },
      message_id: {
        type: Sequelize.STRING,
        allowNull: false,
        references: {
          model: 'messages',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      mentioned_user_id: {
        type: Sequelize.STRING,
        allowNull: false
      },
      position: {
        type: Sequelize.INTEGER,
        defaultValue: 0
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

    // Create reactions table
    await queryInterface.createTable('reactions', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true
      },
      message_id: {
        type: Sequelize.STRING,
        allowNull: false,
        references: {
          model: 'messages',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      emoji: {
        type: Sequelize.STRING,
        allowNull: false
      },
      sender_id: {
        type: Sequelize.STRING,
        allowNull: false
      },
      reaction_count: {
        type: Sequelize.INTEGER,
        defaultValue: 1
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

    // Create message_groups table
    await queryInterface.createTable('message_groups', {
      id: {
        type: Sequelize.STRING,
        primaryKey: true,
        allowNull: false
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
      start_timestamp: {
        type: Sequelize.BIGINT,
        allowNull: false
      },
      end_timestamp: {
        type: Sequelize.BIGINT,
        allowNull: false
      },
      start_date: {
        type: Sequelize.DATE,
        allowNull: false
      },
      end_date: {
        type: Sequelize.DATE,
        allowNull: false
      },
      duration: {
        type: Sequelize.INTEGER,
        defaultValue: 0
      },
      message_count: {
        type: Sequelize.INTEGER,
        defaultValue: 0
      },
      media_count: {
        type: Sequelize.INTEGER,
        defaultValue: 0
      },
      text_count: {
        type: Sequelize.INTEGER,
        defaultValue: 0
      },
      link_count: {
        type: Sequelize.INTEGER,
        defaultValue: 0
      },
      mention_count: {
        type: Sequelize.INTEGER,
        defaultValue: 0
      },
      total_media_size: {
        type: Sequelize.BIGINT,
        defaultValue: 0
      },
      average_message_length: {
        type: Sequelize.INTEGER,
        defaultValue: 0
      },
      statistics: {
        type: Sequelize.JSONB,
        defaultValue: {}
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

    // Create conversation_summaries table
    await queryInterface.createTable('conversation_summaries', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true
      },
      conversation_id: {
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
      start_time: {
        type: Sequelize.DATE,
        allowNull: false
      },
      end_time: {
        type: Sequelize.DATE,
        allowNull: false
      },
      duration: {
        type: Sequelize.INTEGER,
        defaultValue: 0
      },
      message_count: {
        type: Sequelize.INTEGER,
        defaultValue: 0
      },
      participant_count: {
        type: Sequelize.INTEGER,
        defaultValue: 0
      },
      dominant_language: {
        type: Sequelize.STRING,
        allowNull: true
      },
      is_media_heavy: {
        type: Sequelize.BOOLEAN,
        defaultValue: false
      },
      average_messages_per_day: {
        type: Sequelize.FLOAT,
        defaultValue: 0
      },
      peak_hours: {
        type: Sequelize.ARRAY(Sequelize.INTEGER),
        defaultValue: []
      },
      statistics: {
        type: Sequelize.JSONB,
        defaultValue: {}
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

    // Create indexes
    await queryInterface.addIndex('groups', ['name']);
    await queryInterface.addIndex('groups', ['last_activity']);
    await queryInterface.addIndex('authors', ['phone_number']);
    await queryInterface.addIndex('authors', ['push_name']);
    await queryInterface.addIndex('authors', ['last_seen']);
    await queryInterface.addIndex('messages', ['group_id']);
    await queryInterface.addIndex('messages', ['author_id']);
    await queryInterface.addIndex('messages', ['timestamp']);
    await queryInterface.addIndex('messages', ['message_date']);
    await queryInterface.addIndex('messages', ['type']);
    await queryInterface.addIndex('messages', ['has_media']);
    await queryInterface.addIndex('messages', ['is_forwarded']);
    await queryInterface.addIndex('messages', ['detected_language']);
    await queryInterface.addIndex('messages', ['quoted_message_id']);
    await queryInterface.addIndex('media', ['message_id']);
    await queryInterface.addIndex('media', ['file_hash']);
    await queryInterface.addIndex('media', ['media_type']);
    await queryInterface.addIndex('media', ['saved_at']);
    await queryInterface.addIndex('links', ['message_id']);
    await queryInterface.addIndex('links', ['domain']);
    await queryInterface.addIndex('links', ['link_type']);
    await queryInterface.addIndex('mentions', ['message_id']);
    await queryInterface.addIndex('mentions', ['mentioned_user_id']);
    await queryInterface.addIndex('reactions', ['message_id']);
    await queryInterface.addIndex('reactions', ['sender_id']);
    await queryInterface.addIndex('message_groups', ['group_id']);
    await queryInterface.addIndex('message_groups', ['author_id']);
    await queryInterface.addIndex('message_groups', ['start_timestamp']);
    await queryInterface.addIndex('message_groups', ['end_timestamp']);
    await queryInterface.addIndex('conversation_summaries', ['group_id']);
    await queryInterface.addIndex('conversation_summaries', ['start_time']);
    await queryInterface.addIndex('conversation_summaries', ['end_time']);
  },

  async down(queryInterface, Sequelize) {
    // Drop tables in reverse order due to foreign key constraints
    await queryInterface.dropTable('conversation_summaries');
    await queryInterface.dropTable('message_groups');
    await queryInterface.dropTable('reactions');
    await queryInterface.dropTable('mentions');
    await queryInterface.dropTable('links');
    await queryInterface.dropTable('media');
    await queryInterface.dropTable('messages');
    await queryInterface.dropTable('authors');
    await queryInterface.dropTable('groups');
  }
};
MIGRATION_EOF

echo "Running migrations..."
npx sequelize-cli db:migrate

echo "✅ Database setup complete!"
echo ""
echo "To verify the setup, connect to PostgreSQL and check tables:"
echo "psql -U postgres -d whatsapp_monitor_dev -c '\dt'"