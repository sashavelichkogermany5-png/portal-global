Status: reference
Project: Portal Global
Date: n/a
Context: Repo overview, quick start, and feature summary.
Open items: n/a
# PORTAL - File Upload Feature

## 🚀 Quick Start

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Start development server:**
   ```bash
   npm run dev
   ```

3. **Navigate to:** http://localhost:3000/(portal)/orders

## Agent Conversation System
- Deterministic, tenant-scoped agent pipeline (EventNormalizer, Router, UICoach, Leads, Revenue)
- UI: open `/app` and click **Agent Console** to view messages and draft actions
- API: `POST /api/agent/events`, `POST /api/agent/dispatch`, `GET /api/agent/messages`, `GET /api/agent/actions`, `POST /api/agent/actions/execute`

## Deploy on Render

See `DEPLOY-RENDER.md` for the canonical commands, schedules, and env vars. The worker entrypoint is `npm run worker`, the cron entrypoint is `npm run daily-report`, and the test entrypoint is `npm run test:financial-event`.

## 💸 Revenue Tracking & Email Reports

### Database tables (auto-created)
- `financial_events`: `tenant_id`, `user_id`, `type`, `amount`, `currency`, `tags`, `source`, `created_at`
- `email_outbox`: `to`, `subject`, `html`, `text`, `status`, `attempts`, `last_error`, `last_attempt_at`, `created_at`

### API
**POST** `/api/events/financial` (auth required, tenant-aware)

Body example:
```json
{
  "type": "payment_received",
  "amount": 149.99,
  "currency": "EUR",
  "tags": ["subscription", "pro"],
  "source": "stripe"
}
```

### Email worker
- Worker: `npm run worker`
- Daily report: `npm run daily-report`
- Test event: `npm run test:financial-event`
- `ops/run-dev.ps1` starts the worker alongside the API

### Email configuration
- **SMTP**: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_SECURE`, `EMAIL_FROM`
- **SendGrid**: `SENDGRID_API_KEY` + `EMAIL_FROM` (or `SENDGRID_FROM`)
- **Owner alert**: `OWNER_EMAIL` receives immediate `payment_received` notifications
- **Default currency**: `DEFAULT_CURRENCY` (fallback when `currency` is omitted, default `EUR`)
- **Daily report timezone**: Europe/Berlin
- **Worker tuning**: `EMAIL_MAX_ATTEMPTS`, `EMAIL_BATCH_SIZE`, `EMAIL_POLL_INTERVAL_MS`, `EMAIL_STUCK_MINUTES`

## 📁 File Upload Features

### Supported File Types
- PDF documents (✅)
- Microsoft Word (.doc, .docx) (✅)
- Microsoft Excel (.xls, .xlsx) (✅)
- Other common document formats

### File Size Limits
- Maximum file size: 100MB per file
- No limit on number of files

### Upload Methods
1. **Drag & Drop** - Simply drag files onto the upload area
2. **Browse Files** - Click to select files from your computer

## 🎨 User Interface

### Main Upload Area
- Modern dark theme design
- Visual feedback when dragging files
- Real-time progress tracking
- Error handling with clear messages

### Progress Tracking
- Individual progress bars for each file
- Status indicators (pending, uploading, success, error)
- Estimated upload time
- Pause/resume functionality

### File Management
- Remove files before upload
- View file details (name, size, type)
- Retry failed uploads
- Cancel ongoing uploads

## 🔧 Technical Implementation

### Frontend
- **React 18** with TypeScript
- **Next.js 14** App Router
- **Tailwind CSS** for styling
- **Lucide React** for icons

### Backend
- **Node.js** with Express
- **Multer** for file handling
- **File System** storage
- **Next.js API Routes**

### File Storage
- Local storage in `/public/uploads`
- Automatic unique filename generation
- File metadata tracking

## 📝 Usage Instructions

### Creating an Order
1. Navigate to **Orders** page
2. Fill in order details
3. Attach files (optional)
4. Click "Create order"
5. Wait for files to upload
6. Order is created with uploaded files

### Uploading Files
1. Click "Attach files" button
2. Select files from your computer
3. Or drag files directly onto the upload area
4. Monitor progress in real-time
5. Remove files if needed before submission

### File Validation
- Automatic file type checking
- Size limit validation
- Error messages for invalid files
- Progress tracking for valid files

## 🔍 File Types Reference

### Document Formats
- **PDF**: `.pdf`
- **Word**: `.doc`, `.docx`
- **Excel**: `.xls`, `.xlsx`
- **Text**: `.txt`, `.rtf`
- **OpenOffice**: `.odt`, `.ods`

### Image Formats (if enabled)
- **Images**: `.jpg`, `.jpeg`, `.png`, `.gif`, `.svg`

## 🐛 Troubleshooting

### Common Issues

#### Files not uploading
- Check file size (max 100MB)
- Verify file type is supported
- Ensure internet connection
- Check browser console for errors

#### Progress not showing
- Wait a few seconds for upload to start
- Check browser network tab
- Verify server is running

#### Error messages
- "File size exceeds limit" - Reduce file size
- "Invalid file type" - Use supported formats
- "Network error" - Check internet connection

### Debug Mode
Enable debug mode in development:
```bash
DEBUG=portal:* npm run dev
```

## 🔒 Security Features

### File Validation
- MIME type checking
- File extension validation
- Size limits
- Virus scanning (future enhancement)

### Access Control
- Authentication required
- File ownership tracking
- Access logging
- Secure file paths

## 📊 Performance

### Upload Speed
- Optimized for large files
- Concurrent uploads supported
- Progress tracking with accurate estimates
- Resume capability for interrupted uploads

### Browser Compatibility
- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

## 🔄 Future Enhancements

### Planned Features
- Cloud storage integration (AWS S3, Google Cloud)
- File preview functionality
- Batch processing
- Compression for large files
- Virus scanning
- File versioning

### API Extensions
- File metadata API
- Bulk upload operations
- File transformation
- Webhook notifications

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Submit a pull request

### Development Setup
```bash
# Clone the repository
git clone https://github.com/your-repo/portal.git
cd portal

# Install dependencies
npm install

# Start development servers
npm run dev
```

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🙏 Acknowledgments

- React Team for the amazing framework
- Next.js for the excellent platform
- Tailwind CSS for the utility-first approach
- All contributors and supporters

---

**Last Updated:** February 2026
**Version:** 1.0.0
