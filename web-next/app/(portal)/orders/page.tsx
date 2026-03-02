import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { FileUpload } from "./file-upload";
import { FileList } from "./file-list";
import { useFileUpload } from "./lib/upload";

export default async function OrdersPage() {
  const session = await getServerSession(authOptions);

  if (!session) {
    redirect("/login");
  }

  const [orderDetails, setOrderDetails] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const { uploadQueue } = useFileUpload(selectedFiles, "/api/upload");

  const handleFileSelect = (files: File[]) => {
    setSelectedFiles(files);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Здесь будет логика отправки заказа
    console.log("Order details:", orderDetails);
    console.log("Upload queue:", uploadQueue);
    
    // Показываем сообщение об успешной отправке
    alert("Order created successfully!");
  };

  return (
    <main className="min-h-screen bg-black text-white px-6 py-20">
      <div className="container">
        <h1 className="page-title">Create order</h1>
        <p className="page-subtitle">Fill in the details and attach any necessary files</p>

        <form onSubmit={handleSubmit} className="max-w-2xl mx-auto space-y-6">
          <div className="form-group">
            <label className="form-label">
              Order details
            </label>
            <textarea
              rows={4}
              value={orderDetails}
              onChange={(e) => setOrderDetails(e.target.value)}
              className="form-textarea"
              placeholder="Describe your order..."
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label">
              Attach files (optional)
            </label>
            <FileUpload
              onFileSelect={handleFileSelect}
              maxFileSize={100 * 1024 * 1024} // 100MB
              acceptedTypes={['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']}
            />
          </div>

          {uploadQueue.length > 0 && (
            <div className="file-list">
              <h3 className="text-sm font-medium mb-3">Upload progress:</h3>
              <FileList files={uploadQueue} />
            </div>
          )}

          <button
            type="submit"
            disabled={uploadQueue.some(file => file.status === "uploading")}
            className="btn btn-primary w-full"
          >
            {uploadQueue.some(file => file.status === "uploading") 
              ? "Uploading..."
              : "Create order"
            }
          </button>
        </form>
      </div>
    </main>
  );
}

  const [orderDetails, setOrderDetails] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const { uploadQueue } = useFileUpload(selectedFiles, "/api/upload");

  const handleFileSelect = (files: File[]) => {
    setSelectedFiles(files);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Здесь будет логика отправки заказа
    console.log("Order details:", orderDetails);
    console.log("Upload queue:", uploadQueue);
    
    // Показываем сообщение об успешной отправке
    alert("Order created successfully!");
  };

  return (
    <main className="min-h-screen bg-black text-white px-6 py-20">
      <h1 className="text-3xl font-bold mb-4">Create order</h1>

      <form onSubmit={handleSubmit} className="max-w-2xl mx-auto space-y-6">
        <div>
          <label className="block text-lg font-medium mb-2">
            Order details
          </label>
          <textarea
            rows={4}
            value={orderDetails}
            onChange={(e) => setOrderDetails(e.target.value)}
            className="w-full px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-blue-500"
            placeholder="Describe your order..."
            required
          />
        </div>

        <div>
          <label className="block text-lg font-medium mb-2">
            Attach files (optional)
          </label>
          <FileUpload
            onFileSelect={handleFileSelect}
            maxFileSize={100 * 1024 * 1024} // 100MB
            acceptedTypes={['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']}
          />
        </div>

        {uploadQueue.length > 0 && (
          <div className="bg-gray-900 border border-gray-700 rounded-lg p-4">
            <h3 className="text-sm font-medium mb-2">Upload progress:</h3>
            <FileList files={uploadQueue} />
          </div>
        )}

        <button
          type="submit"
          disabled={uploadQueue.some(file => file.status === "uploading")}
          className="w-full px-6 py-3 bg-blue-500 text-white rounded-lg font-medium hover:bg-blue-600 transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {uploadQueue.some(file => file.status === "uploading") 
            ? "Uploading..."
            : "Create order"
          }
        </button>
      </form>
    </main>
  );
}
