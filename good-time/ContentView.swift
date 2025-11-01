//
//  ContentView.swift
//  good-time
//
//  Created by Andrei Alikimovich on 5/25/25.
//

import SwiftUI
import UIKit

struct ContentView: View {
    @StateObject private var settings = AppSettings()
    @AppStorage("showIntro") private var showIntro: Bool = true
    
    // Helper to format time
    func formattedTime(from date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = .autoupdatingCurrent
        formatter.timeStyle = .short
        formatter.dateStyle = .none
        return formatter.string(from: date)
    }
    
    // Calculate wake up times
    func wakeUpTimes(from now: Date) -> [(cycles: Int, time: Date)] {
        let fallAsleepBuffer: TimeInterval = 15 * 60 // 15 minutes
        let cycle: TimeInterval = 90 * 60 // 90 minutes
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
        ZStack {
            if showIntro {
                IntroView(showIntro: $showIntro)
            } else {
                TabView {
                    WakeUpView()
                        .tabItem {
                            Image(systemName: "sunrise.fill")
                            Text("tab.wakeup")
                        }
                    BedTimeView()
                        .tabItem {
                            Image(systemName: "moon.zzz.fill")
                            Text("tab.bedtime")
                        }
                }
                .environmentObject(settings)
            }
        }
    }
}

#Preview {
    ContentView()
}
