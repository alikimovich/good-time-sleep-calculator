import SwiftUI

struct BedTimeView: View {
    @EnvironmentObject var settings: AppSettings
    
    // Helper to format time
    func formattedTime(from date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "h:mm a"
        return formatter.string(from: date)
    }
    // Calculate bed times
    func bedTimes(for wakeUp: Date) -> [(cycles: Int, time: Date)] {
        let fallAsleepBuffer: TimeInterval = TimeInterval(settings.timeToFallAsleep) * 60 // from settings
        let cycle: TimeInterval = TimeInterval(settings.sleepCycleLength) * 60 // from settings
        let base = wakeUp.addingTimeInterval(-fallAsleepBuffer)
        return (3...6).map { cycles in
            (cycles, base.addingTimeInterval(-Double(cycles) * cycle))
        }.reversed()
    }
    // Calculate progress percentage based on cycles
    func progressPercentage(cycles: Int) -> Double {
        let minCycles: Double = 3.0
        let maxCycles: Double = 6.0
        return (Double(cycles) - minCycles) / (maxCycles - minCycles) / 2 + 0.5  
    }
    var body: some View {
        ZStack() {
            Color("BackgroundColor").ignoresSafeArea()
            NavigationView {
                let times: [(cycles: Int, time: Date)] = bedTimes(for: settings.wakeUpTime)
                ScrollView {
                    VStack(alignment: .leading, spacing: 0) {
                        Text(String.localizedStringWithFormat(NSLocalizedString("bedtime.header", comment: ""), formattedTime(from: settings.wakeUpTime)))
                            .font(.system(size: 18, weight: .regular))
                            .foregroundColor(Color("Highlight"))
                            .padding(.horizontal)
                            .padding(.bottom, 16)
                        ForEach(times, id: \.cycles) { item in
                            VStack(alignment: .leading, spacing: 0) {
                                Text(String.localizedStringWithFormat(NSLocalizedString("wakeup.cycles", comment: ""), item.cycles))
                                    .font(.system(size: 14, weight: .semibold))
                                    .foregroundColor(Color("TextColor4"))
                                HStack(alignment: .firstTextBaseline) {
                                    Text(formattedTime(from: item.time))
                                        .font(.title)
                                        .fontWeight(.bold)
                                        .foregroundColor(Color("TextColor\(-item.cycles+7)"))
                                }
                                ProgressView(value: progressPercentage(cycles: item.cycles))
                                    .tint(Color("TextColor\(-item.cycles+7)"))
                                    .padding(.vertical, 8)
                            }
                            .padding(.horizontal)
                            .padding(.vertical, 8)
                        }
                        Spacer()
                        DatePicker(
                            "bedtime.datepicker_title",
                            selection: $settings.wakeUpTime,
                            displayedComponents: .hourAndMinute
                        )
                            .labelsHidden()
                            .datePickerStyle(.wheel)
                            .frame(maxWidth: .infinity)
                            .padding(.bottom, 16)
                            .padding(.horizontal)
                            .padding(.bottom, 0)
                    }
                }
                .navigationBarTitleDisplayMode(.large)
                .navigationTitle("bedtime.title")
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
} 


#Preview {
    BedTimeView()
        .environmentObject(AppSettings())
}
