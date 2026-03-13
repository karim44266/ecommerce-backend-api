# API Contracts

Date: 2026-03-13
Base URL: `http://localhost:3000`
Swagger: `GET /docs`

This document captures the current backend API contracts and validation rules.

## Global Conventions

- Auth header for protected routes: `Authorization: Bearer <jwt>`
- Validation: global `ValidationPipe` with `whitelist`, `forbidNonWhitelisted`, `transform`
- ID format: MongoDB ObjectId for all `:id`, `orderId`, `productId`, etc.

### Common Error Shapes

`400 Bad Request` (validation/business rule):

```json
{
  "statusCode": 400,
  "message": ["field must be ..."],
  "error": "Bad Request"
}
```

`401 Unauthorized`:

```json
{
  "statusCode": 401,
  "message": "Unauthorized"
}
```

`403 Forbidden`:

```json
{
  "statusCode": 403,
  "message": "Forbidden resource"
}
```

`404 Not Found`:

```json
{
  "statusCode": 404,
  "message": "... not found"
}
```

`409 Conflict`:

```json
{
  "statusCode": 409,
  "message": "Resource already exists"
}
```

---

## Health

### GET `/`
- Auth: Public
- Response `200`:

```json
"Hello World!"
```

---

## Auth

### POST `/auth/register`
- Auth: Public
- Request body:

```json
{
  "email": "admin@company.com",
  "password": "Admin123!"
}
```

Validation:
- `email`: valid email
- `password`: string, min length `6`

Response `200` (example):

```json
{
  "accessToken": "<jwt>"
}
```

Errors: `400`, `409`

### POST `/auth/login`
- Auth: Public
- Request body:

```json
{
  "email": "admin@company.com",
  "password": "Admin123!"
}
```

Response `200` (non-MFA):

```json
{
  "accessToken": "<jwt>"
}
```

Response `200` (MFA required):

```json
{
  "mfaRequired": true,
  "email": "admin@company.com"
}
```

Errors: `400`, `401`

### POST `/auth/mfa/verify`
- Auth: Public
- Rate limit: `5` attempts per `60s`
- Request body:

```json
{
  "email": "admin@company.com",
  "otp": "123456"
}
```

Validation:
- `email`: valid email
- `otp`: string, exact length `6`

Response `200`:

```json
{
  "accessToken": "<jwt>"
}
```

Errors: `400`, `401`, `429`

### GET `/auth/me`
- Auth: Bearer
- Response `200`:

```json
{
  "userId": "67d07f0d34f2e8d7fc123456",
  "email": "admin@company.com",
  "roles": ["ADMIN"]
}
```

Errors: `401`

### PATCH `/auth/mfa`
- Auth: Bearer
- Request body:

```json
{
  "enabled": true
}
```

Validation:
- `enabled`: boolean

Response `200`:

```json
{
  "mfaEnabled": true
}
```

Errors: `400`, `401`

---

## Users

> Controller is Bearer-protected. Intended for admin management flows.

### GET `/users?page=1&limit=20&search=term`
- Auth: Bearer
- Query:
  - `page` optional integer
  - `limit` optional integer
  - `search` optional string
- Response `200`:

```json
{
  "items": [
    {
      "id": "67d07f0d34f2e8d7fc123456",
      "email": "user@company.com",
      "role": "customer",
      "status": "active"
    }
  ],
  "total": 1,
  "page": 1,
  "limit": 20
}
```

Errors: `401`

### GET `/users/:id`
- Auth: Bearer
- Response `200`: user object
- Errors: `401`, `404`

### PATCH `/users/:id/role`
- Auth: Bearer
- Request body:

```json
{
  "role": "admin"
}
```

Validation:
- `role`: one of `admin | staff | customer`

Response `200`: updated user
Errors: `400`, `401`, `404`

### PATCH `/users/:id/status`
- Auth: Bearer
- Request body:

```json
{
  "status": "blocked"
}
```

Validation:
- `status`: one of `active | blocked`

Response `200`: updated user
Errors: `400`, `401`, `404`

---

## Categories

### GET `/categories`
- Auth: Public
- Query (optional): `search`, `page`, `limit`, `sortBy`, `sortOrder`
- Response `200`: paginated category list

### GET `/categories/simple`
- Auth: Public
- Response `200`: lightweight category list for dropdowns

### GET `/categories/:id`
- Auth: Public
- Response `200`: category detail
- Errors: `404`

### POST `/categories`
- Auth: Bearer + `ADMIN`
- Request body:

```json
{
  "name": "Electronics",
  "slug": "electronics",
  "description": "All electronic devices and accessories"
}
```

Validation:
- `name`: required, string, max `100`
- `slug`: optional, lowercase slug regex `^[a-z0-9]+(?:-[a-z0-9]+)*$`
- `description`: optional string

Response `201`: created category
Errors: `400`, `401`, `403`, `409`

### PATCH `/categories/:id`
- Auth: Bearer + `ADMIN`
- Body: partial of create payload
- Response `200`: updated category
- Errors: `400`, `401`, `403`, `404`, `409`

### DELETE `/categories/:id`
- Auth: Bearer + `ADMIN`
- Response `200`: deletion result
- Errors: `401`, `403`, `404`, `409`

---

## Products

### GET `/products`
- Auth: Public
- Query (optional):
  - `search`, `category`, `categoryId`, `status`
  - `sortBy`: `name|price|inventory|createdAt|updatedAt|status`
  - `sortOrder`: `asc|desc`
  - `page` (min 1), `limit` (1-100)
- Response `200`: paginated products

### GET `/products/:id`
- Auth: Public
- Response `200`: product detail
- Errors: `404`

### POST `/products`
- Auth: Bearer + `ADMIN`
- Request body:

```json
{
  "name": "Wireless Headphones",
  "sku": "WH-1000",
  "description": "Premium noise-cancelling wireless headphones",
  "price": 99.99,
  "image": "https://example.com/headphones.jpg",
  "inventory": 50,
  "status": "active",
  "categoryId": "67d07f0d34f2e8d7fc123456"
}
```

Validation:
- `name`: required, max `255`
- `sku`: required, max `100`
- `price`: number, min `0`, max 2 decimals
- `inventory`: optional int, min `0`
- `categoryId`: optional MongoId

Response `201`: created product
Errors: `400`, `401`, `403`, `409`

### PATCH `/products/:id`
- Auth: Bearer + `ADMIN`
- Body: partial of create payload
- Response `200`: updated product
- Errors: `400`, `401`, `403`, `404`, `409`

### DELETE `/products/:id`
- Auth: Bearer + `ADMIN`
- Response `200`: deletion result
- Errors: `401`, `403`, `404`

---

## Inventory

> All inventory routes require Bearer + role guard.

### GET `/inventory`
- Auth: Bearer + `ADMIN|STAFF`
- Query: filter/sort/pagination (see `InventoryQueryDto`)
- Response `200`: paginated inventory list

### GET `/inventory/summary`
- Auth: Bearer + `ADMIN|STAFF`
- Response `200`:

```json
{
  "totalProducts": 100,
  "lowStock": 12,
  "outOfStock": 3,
  "inStock": 85
}
```

### GET `/inventory/low-stock`
- Auth: Bearer + `ADMIN|STAFF`
- Query: pagination/sort
- Response `200`: paginated low-stock list

### POST `/inventory/backfill`
- Auth: Bearer + `ADMIN`
- Response `200`: backfill summary

### GET `/inventory/:productId`
- Auth: Bearer + `ADMIN|STAFF`
- Response `200`: inventory record
- Errors: `404`

### GET `/inventory/:productId/history`
- Auth: Bearer + `ADMIN|STAFF`
- Query: history pagination
- Response `200`: adjustment history
- Errors: `404`

### POST `/inventory/:productId/adjust`
- Auth: Bearer + `ADMIN`
- Request body:

```json
{
  "adjustment": -2,
  "reason": "Damaged in warehouse"
}
```

Validation:
- `adjustment`: integer, cannot be `0`
- `reason`: optional string

Response `201`: updated inventory + adjustment result
Errors: `400`, `401`, `403`, `404`

### PATCH `/inventory/:productId/threshold`
- Auth: Bearer + `ADMIN`
- Request body:

```json
{
  "lowStockThreshold": 15
}
```

Validation:
- `lowStockThreshold`: integer, min `0`

Response `200`: updated inventory
Errors: `400`, `401`, `403`, `404`

---

## Orders

> Controller is Bearer-protected.

### POST `/orders`
- Auth: Bearer
- Request body:

```json
{
  "items": [
    { "productId": "67d07f0d34f2e8d7fc123456", "quantity": 2 }
  ],
  "shippingAddress": {
    "fullName": "John Doe",
    "addressLine1": "123 Main St",
    "addressLine2": "Apt 4B",
    "city": "Springfield",
    "state": "IL",
    "postalCode": "62701",
    "country": "US"
  }
}
```

Validation:
- `items`: array min size `1`
- each item: `productId` MongoId, `quantity` int min `1`
- shipping fields required except `addressLine2`

Response `201/200`: created order
Errors: `400`, `401`

### GET `/orders`
- Auth: Bearer
- Behavior: admin sees all; non-admin sees own
- Query: via `OrderQueryDto` (status/search/page/limit/sort)
- Response `200`: paginated order list

### GET `/orders/:id`
- Auth: Bearer
- Response `200`: order with items/tracking/history
- Errors: `401`, `403`, `404`

### PATCH `/orders/:id/status`
- Auth: Bearer + `ADMIN`
- Request body:

```json
{
  "status": "PROCESSING",
  "note": "Payment confirmed"
}
```

Allowed statuses:
- `PENDING`, `ACCEPTED`, `PROCESSING`, `DELIVERED`, `COMPLETED`, `CANCELLED`, `REFUNDED`, `FAILED`

Transition validation enforced server-side.

Response `200`: updated order
Errors: `400`, `401`, `403`, `404`

### POST `/orders/:id/tracking`
- Auth: Bearer + `ADMIN`
- Request body:

```json
{
  "carrier": "FedEx",
  "trackingNumber": "1Z999AA10123456784",
  "note": "Shipped via FedEx Ground"
}
```

Response `200`: updated order with tracking
Errors: `400`, `401`, `403`, `404`

### GET `/orders/:id/history`
- Auth: Bearer
- Response `200`: status/audit history
- Errors: `401`, `403`, `404`

---

## Payments

> Controller is Bearer-protected. Current flow uses internal/mock confirmation endpoint.

### POST `/payments`
- Auth: Bearer
- Request body:

```json
{
  "orderId": "67d07f0d34f2e8d7fc123456"
}
```

Validation:
- `orderId`: required MongoId

Response `200`: payment creation result
Errors: `400`, `401`, `404`

### POST `/payments/:id/confirm`
- Auth: Bearer
- Request body:

```json
{
  "cardNumber": "4242424242424242",
  "cardHolder": "John Doe"
}
```

Validation:
- `cardNumber`, `cardHolder`: optional strings (mock flow)

Response `200`: payment confirmation result
Errors: `400`, `401`, `404`

### GET `/payments/order/:orderId`
- Auth: Bearer
- Response `200`: payment details or `null`
- Errors: `401`, `404`

---

## Shipments

### POST `/shipments`
- Auth: Bearer + `ADMIN`
- Request body:

```json
{
  "orderId": "67d07f0d34f2e8d7fc123456",
  "staffUserId": "67d07f0d34f2e8d7fc999999",
  "trackingNumber": "TRK-12345"
}
```

Validation:
- `orderId`: MongoId
- `staffUserId`: MongoId
- `trackingNumber`: optional string

Response `200`: shipment created
Errors: `400`, `401`, `403`, `404`

### GET `/shipments`
- Auth: Bearer
- Behavior: admin sees all; staff sees own
- Query: `status`, `staffId`, `page`, `limit`
- Response `200`: shipment list

### GET `/shipments/assignable-orders`
- Auth: Bearer + `ADMIN`
- Response `200`: orders eligible for assignment

### GET `/shipments/staff`
- Auth: Bearer + `ADMIN`
- Response `200`: assignable staff users

### GET `/shipments/:id`
- Auth: Bearer
- Response `200`: shipment detail
- Errors: `401`, `403`, `404`

### PATCH `/shipments/:id/status`
- Auth: Bearer (`ADMIN` or owning `STAFF`)
- Request body:

```json
{
  "status": "IN_TRANSIT",
  "note": "Package picked up"
}
```

Allowed statuses:
- `PENDING`, `ASSIGNED`, `IN_TRANSIT`, `DELIVERED`, `FAILED`, `RETURNED`

Transition validation enforced server-side.

Response `200`: updated shipment
Errors: `400`, `401`, `403`, `404`

### PATCH `/shipments/:id/assign`
- Auth: Bearer + `ADMIN`
- Request body:

```json
{
  "staffUserId": "67d07f0d34f2e8d7fc999999"
}
```

Validation:
- `staffUserId`: required MongoId

Response `200`: reassigned shipment
Errors: `400`, `401`, `403`, `404`

---

## Prompt-Target Endpoints Not Yet Live

The feature prompts include some contracts not currently exposed in controllers:

- `POST /payments/intent`
- `POST /payments/webhook`
- `GET /payments/:id`
- `GET /orders/:id/timeline` (current route is `GET /orders/:id/history`)
- `GET /shipments/:id/timeline`

If these are required, implement matching controllers/services and then update this doc to move them into the main sections.
