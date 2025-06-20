# PostgreSQL Setup Guide for Zero-Vector-3

## Step 1: Install PostgreSQL

1. **Run the downloaded installer** (postgresql-16.9-1-windows-x64.exe)

2. **Installation Settings:**
   - **Installation Directory:** Keep default (C:\Program Files\PostgreSQL\16)
   - **Data Directory:** Keep default (C:\Program Files\PostgreSQL\16\data)
   - **Password:** Choose a strong password for the `postgres` superuser (REMEMBER THIS!)
   - **Port:** Keep default `5432`
   - **Locale:** Keep default (English, United States)
   - **Components:** Install all (PostgreSQL Server, pgAdmin 4, Stack Builder, Command Line Tools)

3. **Complete the installation** - this may take 5-10 minutes

## Step 2: Create Zero-Vector-3 Database and User

After installation, we'll use pgAdmin or command line to create:
- Database: `zerovector3`
- User: `zerovector`
- Password: Choose a secure password

### Option A: Using pgAdmin (Graphical Interface)
1. Open pgAdmin 4 from Start Menu
2. Connect using the postgres superuser password you set
3. Right-click "Databases" → Create → Database
   - Name: `zerovector3`
4. Right-click "Login/Group Roles" → Create → Login/Group Role
   - General tab: Name = `zerovector`
   - Definition tab: Password = your chosen password
   - Privileges tab: Check "Can login?" and "Create databases?"
5. Right-click `zerovector3` database → Properties → Security
   - Add `zerovector` user with ALL privileges

### Option B: Using Command Line (psql)
Open Command Prompt as Administrator and run:

```cmd
cd "C:\Program Files\PostgreSQL\16\bin"
psql -U postgres
```

Then run these SQL commands:
```sql
-- Create user
CREATE USER zerovector WITH PASSWORD 'your-secure-password-here';

-- Create database
CREATE DATABASE zerovector3 OWNER zerovector;

-- Grant privileges
GRANT ALL PRIVILEGES ON DATABASE zerovector3 TO zerovector;

-- Connect to the new database and grant schema privileges
\c zerovector3
GRANT ALL ON SCHEMA public TO zerovector;
GRANT CREATE ON SCHEMA public TO zerovector;

-- Exit psql
\q
```

## Step 3: Test Connection

Test the connection with:
```cmd
cd "C:\Program Files\PostgreSQL\16\bin"
psql -U zerovector -d zerovector3 -h localhost
```

If successful, you should see:
```
zerovector3=>
```

Type `\q` to exit.

## Step 4: Update Zero-Vector-3 Configuration

Update the `.env` file with your actual credentials:
```env
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_USER=zerovector
POSTGRES_PASSWORD=your-actual-password-here
POSTGRES_DATABASE=zerovector3
POSTGRES_URL=postgresql://zerovector:your-actual-password-here@localhost:5432/zerovector3
```

## Step 5: Run Infrastructure Setup

After updating the .env file:
```cmd
cd zero-vector-3/server
npm run setup:infrastructure
```

## Troubleshooting

### Connection Issues
- Ensure PostgreSQL service is running (Services → postgresql-x64-16)
- Check Windows Firewall isn't blocking port 5432
- Verify credentials in .env file match what you created

### Permission Issues
- Make sure `zerovector` user has proper privileges
- Try connecting as postgres superuser first to verify server is working

### Service Not Starting
- Check Windows Services for "postgresql-x64-16"
- Restart the service if needed
- Check PostgreSQL logs in: C:\Program Files\PostgreSQL\16\data\log\
