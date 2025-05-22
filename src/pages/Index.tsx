
import RoomModeCalculator from "@/components/RoomModeCalculator";

const Index = () => {
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-primary text-primary-foreground py-4 px-6 shadow-md">
        <h1 className="text-2xl font-semibold">Room Mode Calculator</h1>
      </header>
      <main className="container mx-auto p-4">
        <RoomModeCalculator />
      </main>
    </div>
  );
};

export default Index;
