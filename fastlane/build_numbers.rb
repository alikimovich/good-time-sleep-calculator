# LKM-650: the App Store Connect build queries of the release lanes, copied from agent-messenger's
# fastlane/build_numbers.rb (LKM-439), kept out of the Fastfile so scripts/release.test.ts can check their shape.
#
# Every query passes `includes` explicitly. Spaceship's defaults are not safe: in fastlane 2.241.2
# `get_builds` includes betaBuildMetrics, which Apple rejects ("betaBuildMetrics is not a valid
# relationship name"). Include only what the lanes read.
module GoodTimeBuildNumbers
  # The highest-number query reads only each build's version, so it includes nothing.
  LIST_INCLUDES = nil
  # The status lane reads processing_state, uploaded_date and expired (attributes), and
  # build_beta_detail.internal_build_state, so it includes buildBetaDetail only.
  STATUS_INCLUDES = "buildBetaDetail".freeze
  PAGE_SIZE = 200

  # Keyword arguments for Spaceship::ConnectAPI.get_builds: every build of the app, newest first.
  def self.list_query(app_id)
    { filter: { app: app_id }, includes: LIST_INCLUDES, limit: PAGE_SIZE, sort: "-uploadedDate" }
  end

  # Keyword arguments for Spaceship::ConnectAPI::Build.all: one build by marketing version and number.
  def self.status_query(app_id, version, build_number)
    { app_id: app_id, version: version, build_number: build_number, includes: STATUS_INCLUDES }
  end

  # client: Spaceship::ConnectAPI (or a fake with get_builds). Pages through every build.
  def self.latest_for_app(client, app_id)
    max_build_number(client.get_builds(**list_query(app_id)))[:max]
  end

  # build_model: Spaceship::ConnectAPI::Build (or a fake with all). The build, or nil.
  def self.find_build(build_model, app_id, version, build_number)
    build_model.all(**status_query(app_id, version, build_number)).first
  end

  # first_page responds to to_models (builds with a version) and next_page (nil after the last page).
  # Apple returns at most 200 builds per page, newest uploads first, so the first page alone can miss
  # the highest number. Returns { max: Integer or nil, builds: Integer, pages: Integer }.
  def self.max_build_number(first_page)
    max = nil
    builds = 0
    pages = 0
    page = first_page
    while page
      pages += 1
      page.to_models.each do |build|
        builds += 1
        number = build.version.to_s.to_i
        max = number if max.nil? || number > max
      end
      page = page.next_page
    end
    { max: max, builds: builds, pages: pages }
  end
end
