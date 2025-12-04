export default function WelcomePage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="text-center">
        <h1 className="text-6xl font-bold text-gray-800 mb-4">
          Welcome
        </h1>
        <p className="text-xl text-gray-600 mb-8">
          We're glad to have you here
        </p>
        <button className="bg-indigo-600 text-white px-8 py-3 rounded-lg hover:bg-indigo-700 transition-colors">
          Get Started
        </button>
      </div>
    </div>
  );
}