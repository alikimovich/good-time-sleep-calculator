import SwiftUI

struct WakeUpView: View {
    @EnvironmentObject var settings: AppSettings
    
    // Helper to format time
    func formattedTime(from date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "h:mm a"
        return formatter.string(from: date)
    }
    
    // Calculate wake up times
    func wakeUpTimes(from now: Date) -> [(cycles: Int, time: Date)] {
        let fallAsleepBuffer: TimeInterval = TimeInterval(settings.timeToFallAsleep) * 60 // from settings
        let cycle: TimeInterval = TimeInterval(settings.sleepCycleLength) * 60 // from settings
        let base = now.addingTimeInterval(fallAsleepBuffer)
        return (3...6).map { cycles in
            (cycles, base.addingTimeInterval(Double(cycles) * cycle))
        }
    }
    // Calculate progress percentage based on cycles
    func progressPercentage(cycles: Int) -> Double {
        let minCycles = 3.0
        let maxCycles = 6.0
        return (Double(cycles) - minCycles) / (maxCycles - minCycles) / 2 + 0.5  
    }
    var body: some View {
        NavigationView {
            let now = Date()
            let times = wakeUpTimes(from: now)
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    Text("wakeup.header")
                        .font(.system(size: 18, weight: .regular))
                        .foregroundColor(Color("Highlight"))
                        .padding(.horizontal)
                        .padding(.bottom, 16)
                    ForEach(times, id: \.cycles) { item in
                        VStack(alignment: .leading, spacing: 0) {
                            Text(String.localizedStringWithFormat(NSLocalizedString("wakeup.cycles", comment: ""), item.cycles))
                                .font(.system(size: 14, weight: .semibold))
                                .foregroundColor(Color("TextColor4"))
                            HStack(alignment: .firstTextBaseline, spacing: 0) {
                                Text(formattedTime(from: item.time))
                                    .font(.title)
                                    .fontWeight(.bold)
                                    .foregroundColor(Color("TextColor\(-item.cycles + 7)"))
                                if item.cycles == 5 {
                                    Text("wakeup.best_time")
                                        .font(.system(size: 18, weight: .regular, design: .serif))
                                        .foregroundColor(Color("Highlight"))
                                        .italic()
                                        .padding(.leading, 8)
                                }
                            }
                            ProgressView(value: progressPercentage(cycles: item.cycles))
                                .tint(Color("TextColor\(-item.cycles + 7)"))
                                .padding(.vertical, 8)
                        }
                        .padding(.horizontal)
                        .padding(.vertical, 8)
                    }
                    Spacer()
                    HStack {
                        Text("wakeup.footer")
                            .font(.system(size: 16, weight: .regular))
                            .foregroundColor(Color("TextColor2"))
                            .padding()
                            .background(Color("CardPressed"))
                            .cornerRadius(20)
                    }
                    .padding(.horizontal)
                    .padding(.bottom, 32)
                }
            }
            .navigationBarTitleDisplayMode(.large)
            .navigationTitle(Text("wakeup.title"))
            .background(Color("BackgroundColor").ignoresSafeArea())
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    NavigationLink(destination: SettingsView(settings: settings)) {
                        Image(systemName: "gearshape.fill")
                            .foregroundColor(Color("Highlight"))
                    }
                }
            }
        }
    }
} 
