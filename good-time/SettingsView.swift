import SwiftUI

struct SettingsView: View {
    @ObservedObject var settings: AppSettings
    @State private var showFallAsleepPicker = false
    @State private var showSleepCyclePicker = false

    var body: some View {
        ZStack(alignment: .bottom) {
            //Add some space between the top of the screen and the form
            Spacer(minLength: 20)
            Form {
                Section(header: Text("settings.section.sleep_details")) {
                    Button(action: {
                        withAnimation {
                            self.showFallAsleepPicker = true
                        }
                    }) {
                        HStack {
                            Text("settings.time_to_fall_asleep")
                                .foregroundColor(.primary)
                            Spacer()
                            Text(String.localizedStringWithFormat(NSLocalizedString("settings.minute", comment: ""), settings.timeToFallAsleep))
                                .foregroundColor(.secondary)
                        }
                    }

                    Button(action: {
                        withAnimation {
                            self.showSleepCyclePicker = true
                        }
                    }) {
                        HStack {
                            Text("settings.sleep_cycle_length")
                                .foregroundColor(.primary)
                            Spacer()
                            Text(String.localizedStringWithFormat(NSLocalizedString("settings.minute", comment: ""), settings.sleepCycleLength))
                                .foregroundColor(.secondary)
                        }
                    }
                }

                Section(header: Text("settings.section.wake_up")) {
                    DatePicker("settings.wake_up_time", selection: $settings.wakeUpTime, displayedComponents: .hourAndMinute)
                }
            }
            .navigationTitle("settings.title")
            .disabled(showFallAsleepPicker || showSleepCyclePicker)

            if showFallAsleepPicker {
                Color.black.opacity(0.4)
                    .ignoresSafeArea()
                    .onTapGesture {
                        withAnimation {
                            showFallAsleepPicker = false
                        }
                    }

                VStack(spacing: 0) {
                    HStack {
                        Spacer()
                        Button("settings.done") {
                            withAnimation {
                                showFallAsleepPicker = false
                            }
                        }
                        .padding()
                    }
                    .background(Color(.secondarySystemBackground))
                    
                    Picker("settings.time_to_fall_asleep", selection: $settings.timeToFallAsleep) {
                        ForEach(Array(stride(from: 5, through: 60, by: 5)), id: \.self) { minute in
                            Text(String.localizedStringWithFormat(NSLocalizedString("settings.minute", comment: ""), minute)).tag(minute)
                        }
                    }
                    .pickerStyle(.wheel)
                    .labelsHidden()
                    .background(Color(.secondarySystemBackground))
                }
                .transition(.move(edge: .bottom))
            }

            if showSleepCyclePicker {
                Color.black.opacity(0.4)
                    .ignoresSafeArea()
                    .onTapGesture {
                        withAnimation {
                            showSleepCyclePicker = false
                        }
                    }

                VStack(spacing: 0) {
                    HStack {
                        Spacer()
                        Button("settings.done") {
                            withAnimation {
                                showSleepCyclePicker = false
                            }
                        }
                        .padding()
                    }
                    .background(Color(.secondarySystemBackground))
                    
                    Picker("settings.sleep_cycle_length", selection: $settings.sleepCycleLength) {
                        ForEach(Array(stride(from: 70, through: 120, by: 5)), id: \.self) { minute in
                            Text(String.localizedStringWithFormat(NSLocalizedString("settings.minute", comment: ""), minute)).tag(minute)
                        }
                    }
                    .pickerStyle(.wheel)
                    .labelsHidden()
                    .background(Color(.secondarySystemBackground))
                }
                .transition(.move(edge: .bottom))
            }
        }
    }
} 
