import SwiftUI

struct IntroView: View {
    @Binding var showIntro: Bool
    @State private var offset = CGSize.zero

    var body: some View {
        ZStack {
            Color("BackgroundColor").ignoresSafeArea()
            
            HStack {
                VStack(alignment: .leading, spacing: 60) {
                    
                    Text("intro.title")
                        .font(.system(size: 40, weight: .regular, design: .serif))
                        .foregroundColor(Color("Highlight"))
                        .lineSpacing(8)
                        .padding(.top, 40)

                    VStack(alignment: .leading, spacing: 30) {
                        Text("intro.subtitle")
                            .font(.system(size: 40, weight: .regular, design: .serif))
                            .foregroundColor(Color("Highlight"))
                            .lineSpacing(6)

                        Button(action: {
                            withAnimation {
                                showIntro = false
                            }
                        }) {
                            Text("⟼")
                                .font(.system(size: 64, weight: .regular, design: .serif))
                                .foregroundColor(Color("Highlight"))
                        }
                    }
                    Spacer()
                }
                .padding(.horizontal, 32)
                .frame(maxWidth: 414)
                .offset(x: offset.width)
                .gesture(
                    DragGesture()
                        .onChanged { gesture in
                            if gesture.translation.width < 0 {
                                offset = gesture.translation
                            }
                        }
                        .onEnded { gesture in
                            if gesture.translation.width < -100 {
                                withAnimation {
                                    showIntro = false
                                }
                            } else {
                                withAnimation(.spring()) {
                                    offset = .zero
                                }
                            }
                        }
                )
                Spacer()
            }
        }
    }
}

#Preview {
    IntroView(showIntro: .constant(true))
        .preferredColorScheme(.dark)
} 
