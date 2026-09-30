# Vehicle Service Booking & Tracking System

Express + MySQL backend with JWT login and a browser frontend. Customers book and track services; the service center manages job cards, technicians, spare parts and invoices.

## Run it in VS Code

1. Install [Node.js](https://nodejs.org) (LTS) and MySQL Server.
2. Unzip the project, then in VS Code use **File > Open Folder** and pick `vehicle-service`.
3. Open the terminal (**Ctrl + `**) and create the database:
   ```
   mysql -u root -p < schema.sql
   ```
   On Windows, if `mysql` is not recognised, open **MySQL Workbench**, open `schema.sql`, and run it.
4. Copy `.env.example` to `.env` and set `DB_PASSWORD` (and a long `JWT_SECRET`).
5. Install and start:
   ```
   npm install
   npm start
   ```
6. Open http://localhost:3000

**Logins**
- Service center: `service@center.com` / `center123` (created automatically on first start)
- Customer: click *Create account* on the login page

Use `npm run dev` to restart automatically when you edit files (Node 18.11+).

## Try the full flow
1. Register a customer, add a vehicle (like `TS09AB1234`), book a service.
2. Log out, log in as the service center: create the job card, start the service, add parts, mark ready.
3. Log back in as the customer: check the status, notifications and pay the invoice.

## API summary
| Method | Route | Who |
|---|---|---|
| POST | `/api/auth/register`, `/api/auth/login` | public |
| GET/POST | `/api/vehicles` | customer |
| POST | `/api/bookings` | customer |
| GET | `/api/bookings/mine` | customer |
| POST | `/api/bookings/:id/pay` | customer |
| GET | `/api/center/bookings`, `/technicians`, `/parts` | center |
| POST | `/api/center/bookings/:id/jobcard`, `/start`, `/parts`, `/ready` | center |
| GET | `/api/services`, `/api/notifications` | any logged-in user |

## Where each syllabus topic shows up
| Topic | Where |
|---|---|
| CO1 ER model, 3NF schema, constraints, indexes | `schema.sql` |
| CO1 joins, subquery, aggregates | `BOOKINGS` query in `server.js` |
| CO1 ACID transactions, row locking | `tx()`, add-part and ready routes |
| CO3 REST API design | routes in `server.js` |
| CO3 JWT, hashing, RBAC | `auth()` middleware, bcrypt in register/login |
| CO4 Node/Express, middleware, validation | `server.js` |

## Not built yet (next steps)
- Real Razorpay checkout and FCM push notifications (payment is simulated).
- MongoDB for logs (CO2), FastAPI gateway (CO3/CO5), microservices split, Docker, CI/CD (CO5/CO6).
