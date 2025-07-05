import Foundation
import SwiftUI
import Combine

class AppSettings: ObservableObject {
    @AppStorage("timeToFallAsleep") var timeToFallAsleep: Int = 15
    @AppStorage("sleepCycleLength") var sleepCycleLength: Int = 90
    @AppStorage("bedtimeAutoReminders") var bedtimeAutoReminders: Bool = false
    
    @Published var wakeUpTime: Date {
        didSet {
            let components = Calendar.current.dateComponents([.hour, .minute], from: wakeUpTime)
            UserDefaults.standard.set(components.hour, forKey: "wakeUpTime_hour")
            UserDefaults.standard.set(components.minute, forKey: "wakeUpTime_minute")
        }
    }
    
    init() {
        let hour = UserDefaults.standard.object(forKey: "wakeUpTime_hour") as? Int ?? 8
        let minute = UserDefaults.standard.object(forKey: "wakeUpTime_minute") as? Int ?? 0
        self.wakeUpTime = Calendar.current.date(bySettingHour: hour, minute: minute, second: 0, of: Date()) ?? Date()
    }
} 