import java.io.IOException;
import java.sql.*;
import javax.servlet.http.*;

public class UsuarioServlet extends HttpServlet {
    private Connection conn;

    protected void doGet(HttpServletRequest request, HttpServletResponse response) throws IOException {
        String id = request.getParameter("id");
        try {
            PreparedStatement ps = conn.prepareStatement("SELECT nombre FROM usuarios WHERE id = ?");
            ps.setString(1, id);
            ResultSet rs = ps.executeQuery();
            response.setContentType("application/json");
        } catch (SQLException e) {
            response.sendError(500);
        }
    }
}
